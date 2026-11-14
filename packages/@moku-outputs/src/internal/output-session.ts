/**
 * Share and release the renderer's page-wide native registries.
 *
 * @module
 */
import { Effect, Stream } from "effect";
import type * as Interaction from "@moku/core/Interaction";
import type { Session } from "./session.ts";
import { loadRenderer } from "./renderer.ts";

export type Runtime = Interaction.Interface;
export interface State {
  readonly session: Session | null;
  readonly error: Error | null;
}
interface Entry {
  readonly runtime: Runtime;
  readonly controller: AbortController;
  readonly listeners: Set<(state: State) => void>;
  state: State;
}
let active: Entry | undefined;

export function acquire(
  runtime: Runtime,
  listener: (state: State) => void,
): () => void {
  if (active && active.runtime !== runtime)
    throw new Error("Interactive outputs currently support one notebook per page.");
  let entry = active;
  if (!entry) {
    entry = {
      runtime,
      controller: new AbortController(),
      listeners: new Set(),
      state: { session: null, error: null },
    };
    active = entry;
    void start(entry);
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

async function start(entry: Entry) {
  const { runtime, controller } = entry;
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
      runtime.events.pipe(
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
                  assetUrl: runtime.assetUrl,
                  sendComponentValues: (request) =>
                    run(
                      runtime.setUIValues({
                        runtimeId,
                        values: Object.fromEntries(
                          request.objectIds.map((id, index) => [
                            id,
                            request.values[index],
                          ]),
                        ),
                      }),
                    ),
                  invoke: (request) => run(runtime.invoke({ ...request, runtimeId })),
                  sendModelValue: (request) =>
                    run(runtime.sendWidgetMessage({ ...request, runtimeId })),
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
