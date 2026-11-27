/** Reconcile resumable protocol streams into scoped state atoms. @module */
import {
  Cause,
  Duration,
  Effect,
  Exit,
  Fiber,
  Option,
  Semaphore,
  Stream,
} from "effect";
import { Sse } from "effect/encoding";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";

import { isRejection, ModelError } from "./client.ts";
export const observe = Effect.fnUntraced(function* <
  S,
  A,
  E,
  OpenError,
  Event extends { readonly event: string; readonly id?: string },
>(options: {
  readonly initial: () => S;
  readonly reduce: (state: S, event: Event) => S;
  readonly resume: (state: S) => S;
  readonly value: (state: S) => A;
  readonly open: (
    cursor: string | undefined,
  ) => Effect.Effect<Stream.Stream<Event, E>, OpenError>;
}) {
  const registry = yield* AtomRegistry.AtomRegistry;
  type Error = E | OpenError | ModelError;
  const current = Atom.make<AsyncResult.AsyncResult<A, Error>>(
    AsyncResult.initial(true),
  );
  yield* Atom.mount(current);
  const publish = (next: AsyncResult.AsyncResult<A, Error>) =>
    registry.set(current, next);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() =>
      publish(
        AsyncResult.failureWithPrevious(
          Cause.fail(
            new ModelError({ reason: "closed", message: "The observation is closed." }),
          ),
          { previous: Option.some(registry.get(current)) },
        ),
      ),
    ),
  );
  const owner = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  function reader() {
    let state = options.initial();
    let cursor: string | undefined;
    let attempt = 0;
    const consume = <X>(stream: Stream.Stream<Event, X>) => {
      if (!cursor) state = options.initial();
      else state = options.resume(state);
      publish(AsyncResult.waiting(registry.get(current)));
      let ready = false;
      return Stream.runForEach(stream, (event) =>
        Effect.try({
          try: () => {
            if (event.event === "reset") {
              cursor = undefined;
              ready = false;
              state = options.initial();
              publish(AsyncResult.initial(true));
            }
            state = options.reduce(state, event);
            if (event.event === "ready") {
              ready = true;
              attempt = 0;
            }
            // Replay mutates the retained state too. Resume after the last
            // applied event, even if this connection ends before ready.
            if (event.id !== undefined && (ready || cursor !== undefined))
              cursor = event.id;
            if (ready) publish(AsyncResult.success(options.value(state)));
          },
          catch: (cause) =>
            new ModelError({ reason: "invalid-state", message: String(cause) }),
        }),
      );
    };
    return {
      consume,
      get cursor() {
        return cursor;
      },
      nextAttempt: () => attempt++,
    };
  }
  const run = Effect.gen(function* () {
    const snapshot = reader();
    while (true) {
      const result = yield* Effect.exit(
        snapshot.consume(Stream.unwrap(options.open(snapshot.cursor))),
      );
      let retryDelay: number | undefined;
      if (Exit.isFailure(result)) {
        const errors = Cause.squash(result.cause);
        if (Sse.Retry.is(errors)) retryDelay = Duration.toMillis(errors.duration);
        if (!Sse.Retry.is(errors)) {
          const terminal =
            errors instanceof ModelError ||
            (typeof errors === "object" &&
              errors !== null &&
              "_tag" in errors &&
              errors._tag === "SchemaError") ||
            isRejection(errors);
          publish(
            AsyncResult.failureWithPrevious(result.cause, {
              previous: Option.some(registry.get(current)),
              waiting: !terminal,
            }),
          );
          if (terminal) return;
        }
      }
      publish(AsyncResult.waiting(registry.get(current)));
      yield* Effect.sleep(
        retryDelay ?? Math.min(250 * 2 ** snapshot.nextAttempt(), 10_000),
      );
    }
  });
  let fiber: Fiber.Fiber<unknown, unknown> = yield* Effect.forkIn(run, owner);
  const replace = Effect.fnUntraced(function* <X>(next: Effect.Effect<void, X>) {
    yield* Fiber.interrupt(fiber);
    publish(AsyncResult.waiting(registry.get(current)));
    const started = yield* Effect.forkIn(next, owner);
    fiber = started;
    return started;
  });
  const reconnect = lock
    .withPermit(replace(run))
    .pipe(Effect.asVoid, Effect.uninterruptible);

  // A viewer supplies a full notebook snapshot, with cursors local to its session.
  // Stop the previous reader before opening it, then resume ordinary observation on release.
  const withSnapshot = <X>(stream: Stream.Stream<Event, X>) =>
    Effect.acquireUseRelease(
      lock.withPermit(replace(Effect.suspend(() => reader().consume(stream)))),
      (active) =>
        Fiber.await(active).pipe(
          Effect.flatMap((exit) => {
            if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
              return Effect.failCause(exit.cause);
            return Effect.fail(
              new ModelError({
                reason: "closed",
                message: "The notebook event stream ended.",
              }),
            );
          }),
        ),
      (active) =>
        lock.withPermit(
          Effect.suspend(() =>
            fiber === active && owner.state._tag !== "Closed"
              ? replace(run).pipe(Effect.asVoid)
              : Effect.void,
          ),
        ),
    );
  const state = Atom.readable((get) => {
    if (get.registry !== registry)
      throw new Error("Use the registry that acquired this model.");
    return get(current);
  });
  return { state, reconnect, withSnapshot };
});
