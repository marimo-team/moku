/**
 * Connect runtime events to shared renderer sessions.
 *
 * Consumers share one connection. Runtime changes replace its session, and the
 * last consumer's release stops observation and disposes the session.
 *
 * @module
 */
import type * as Notebook from "@moku/core/Notebook";
import { Cause, Effect, Exit, Semaphore, Stream } from "effect";
import type * as RendererSession from "./RendererSession.ts";
import { WidgetUpdates } from "./WidgetUpdates.ts";
import { loadRenderer } from "./renderer.ts";

/** Renderer availability after applying output notifications. */
export interface State {
  /** Null before kernel initialization, after a reset, or after release. */
  readonly session: RendererSession.Interface | null;
  /** A renderer loading or notification-handling failure, otherwise null. */
  readonly error: Error | null;
}
interface Entry {
  readonly comm: Notebook.Runtime["experimentalComm"];
  readonly controller: AbortController;
  readonly listeners: Set<(state: State) => void>;
  state: State;
}
let active: Entry | undefined;

/**
 * Shares the renderer session and publishes its current state immediately.
 *
 * The returned release function ends this reader's ownership. The last release
 * aborts observation and disposes the session. A different notebook cannot acquire
 * the page-wide registries while this one still has readers.
 */
export function acquire(
  comm: Notebook.Runtime["experimentalComm"],
  assetUrl: (path: string) => string,
  listener: (state: State) => void,
): () => void {
  if (active && active.comm !== comm)
    throw new Error("Interactive outputs currently support one notebook per page.");
  let entry = active;
  if (!entry) {
    entry = {
      comm,
      controller: new AbortController(),
      listeners: new Set(),
      state: { session: null, error: null },
    };
    active = entry;
    const owner = entry;
    Effect.runFork(
      start(owner, assetUrl).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (owner.controller.signal.aborted) return;
            owner.state.session?.dispose();
            publish(owner, {
              session: null,
              error: Exit.isFailure(exit) ? new Error(Cause.pretty(exit.cause)) : null,
            });
          }),
        ),
      ),
      { signal: owner.controller.signal },
    );
  }
  const current = entry;
  current.listeners.add(listener);
  listener(current.state);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size !== 0) return;
    current.controller.abort();
    current.state.session?.dispose();
    current.state = { session: null, error: null };
    if (active === current) active = undefined;
  };
}

function publish(entry: Entry, state: State) {
  entry.state = state;
  for (const listener of entry.listeners) listener(state);
}

type Write = Parameters<Notebook.Runtime["experimentalComm"]["send"]>[0];
const start = Effect.fnUntraced(function* (
  entry: Entry,
  assetUrl: (path: string) => string,
) {
  const {
    comm,
    controller: { signal },
  } = entry;
  const renderer = yield* Effect.tryPromise(loadRenderer);
  const lock = yield* Semaphore.make(1);
  let updates: WidgetUpdates | undefined;

  const apply = (notification: Parameters<RendererSession.Interface["handle"]>[0]) => {
    const session = entry.state.session;
    return session
      ? Effect.tryPromise(() => session.handle(notification))
      : Effect.void;
  };
  // The embedded marimo renderer calls these methods as ordinary browser promises.
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    signal.aborted
      ? Promise.reject(new Error("The output session has ended."))
      : Effect.runPromise(effect, { signal });

  yield* comm.events.pipe(
    Stream.runForEach((event) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (event.kind === "reset") {
            updates = undefined;
            entry.state.session?.dispose();
            publish(entry, { session: null, error: null });
            return;
          }
          if (entry.state.session?.runtimeId === event.runtimeId) {
            const change = updates?.receive(event.notification, event.requestId);
            if (change) yield* apply(change);
            return;
          }
          if (event.notification.op === "kernel-ready") {
            entry.state.session?.dispose();
            const runtimeId = event.runtimeId;
            const local = new WidgetUpdates();
            updates = local;
            const send = Effect.fnUntraced(function* (write: Write) {
              const receipt = local.begin(write);
              yield* comm.send(write, receipt.key).pipe(
                Effect.catch((error) =>
                  lock.withPermit(
                    Effect.gen(function* () {
                      if (updates === local)
                        yield* Effect.forEach(receipt.reject(), apply, {
                          discard: true,
                        });
                      return yield* error;
                    }),
                  ),
                ),
              );
            });
            const session = renderer.createSession({
              runtimeId,
              assetUrl,
              sendComponentValues: ({ objectIds, values }) =>
                run(
                  send({
                    _tag: "SetValues",
                    runtimeId,
                    values: Object.fromEntries(
                      objectIds.map((id, i) => [id, values[i]]),
                    ),
                  }),
                ),
              invoke: ({ functionCallId, functionName, namespace, args }) =>
                run(
                  comm.invoke({
                    call: functionCallId,
                    name: functionName,
                    namespace,
                    args,
                    runtimeId,
                  }),
                ),
              sendModelValue: (request) =>
                run(
                  send({
                    _tag: "Model",
                    runtimeId,
                    model: request.modelId,
                    message: request.message,
                    buffers: request.buffers,
                  }),
                ),
            });
            entry.state = { session, error: null };
            local.receive(event.notification);
            yield* apply(event.notification);
            if (!signal.aborted) publish(entry, { session, error: null });
          }
        }),
      ),
    ),
  );
});
