/** Reconcile resumable protocol streams into scoped state atoms. @module */
import { Cause, Duration, Effect, Exit, Option, Stream } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { Sse } from "effect/encoding";
import { ModelError } from "./client.ts";
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
  let state = options.initial();
  let cursor: string | undefined;
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
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      let attempt = 0;
      while (true) {
        if (!cursor) state = options.initial();
        else state = options.resume(state);
        publish(AsyncResult.waiting(registry.get(current)));
        let ready = false;
        const result = yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              const stream = yield* options.open(cursor);
              yield* Stream.runForEach(stream, (event) =>
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
                    if (ready && event.id !== undefined && event.event !== "reset")
                      cursor = event.id;
                    if (ready) publish(AsyncResult.success(options.value(state)));
                  },
                  catch: (cause) =>
                    new ModelError({ reason: "invalid-state", message: String(cause) }),
                }),
              );
            }),
          ),
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
              (typeof errors === "object" &&
                errors !== null &&
                "status" in errors &&
                typeof errors.status === "number" &&
                errors.status >= 400 &&
                errors.status < 500);
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
        yield* Effect.sleep(retryDelay ?? Math.min(250 * 2 ** attempt++, 10_000));
      }
    }),
  );
  return Atom.readable((get) => {
    if (get.registry !== registry)
      throw new Error("Use the registry that acquired this model.");
    return get(current);
  });
});
