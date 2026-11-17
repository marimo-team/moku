/**
 * Connect native interaction events to shared renderer sessions.
 *
 * Consumers share one connection. Runtime changes replace its session, and the
 * last consumer's release stops observation and disposes the session.
 *
 * @module
 */
import { Effect, Stream } from "effect";
import * as Comm from "@moku/core/experimental/Comm";
import type * as RendererSession from "./RendererSession.ts";
import { loadRenderer } from "./renderer.ts";

/** Renderer availability after applying native output notifications. */
export interface State {
  /** Null before kernel initialization, after a reset, or after release. */
  readonly session: RendererSession.Interface | null;
  /** A renderer loading or notification-handling failure, otherwise null. */
  readonly error: Error | null;
}
interface Entry {
  readonly comm: Comm.Interface;
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
  comm: Comm.Interface,
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
    void start(entry, assetUrl);
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

async function start(entry: Entry, assetUrl: (path: string) => string) {
  const { comm, controller } = entry;
  const signal = controller.signal;
  function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
    if (signal.aborted)
      return Promise.reject(new Error("The output session has ended."));
    return Effect.runPromise(effect, { signal });
  }
  try {
    const renderer = await loadRenderer();
    if (signal.aborted) return;
    await Effect.runPromise(
      comm.events.pipe(
        Stream.runForEach((event) =>
          Effect.tryPromise({
            try: async () => {
              if (signal.aborted) return;
              if (event.kind === "reset") {
                entry.state.session?.dispose();
                publish(entry, { session: null, error: null });
                return;
              }
              if (event.notification.op === "kernel-ready") {
                entry.state.session?.dispose();
                const runtimeId = event.runtimeId;
                const session = renderer.createSession({
                  runtimeId,
                  assetUrl,
                  sendComponentValues: (request) =>
                    run(
                      comm.send(
                        Comm.SetValues({
                          runtimeId,
                          values: Object.fromEntries(
                            request.objectIds.map((id, index) => [
                              id,
                              request.values[index],
                            ]),
                          ),
                        }),
                      ),
                    ),
                  invoke: (request) => run(comm.invoke({ ...request, runtimeId })),
                  sendModelValue: (request) =>
                    run(
                      comm.send(
                        Comm.Model({
                          model: request.modelId,
                          message: request.message,
                          buffers: request.buffers,
                          runtimeId,
                        }),
                      ),
                    ),
                });
                entry.state = { session, error: null };
                await session.handle(event.notification);
                if (signal.aborted) {
                  session.dispose();
                  return;
                }
                publish(entry, { session, error: null });
                return;
              }
              if (entry.state.session?.runtimeId === event.runtimeId)
                await entry.state.session.handle(event.notification);
            },
            catch: (cause) =>
              cause instanceof Error ? cause : new Error(String(cause)),
          }),
        ),
      ),
      { signal },
    );
  } catch (cause) {
    if (!signal.aborted) {
      entry.state.session?.dispose();
      publish(entry, {
        session: null,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      });
    }
  } finally {
    if (!signal.aborted) {
      entry.state.session?.dispose();
      publish(entry, { ...entry.state, session: null });
    }
  }
}
