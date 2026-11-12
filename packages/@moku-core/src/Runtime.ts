/**
 * Execution and output interactions owned by a notebook.
 *
 * The namespace survives kernel restarts. Output requests may name their
 * producing runtime so stale controls cannot operate on its replacement.
 *
 * @module
 */
import { Data, Effect, Queue, type Stream } from "effect";
import { AtomRegistry, type Atom } from "effect/reactivity";
import type * as Notebook from "./Notebook.ts";
import type * as Protocol from "./Protocol.ts";
import type * as Interaction from "./Interaction.ts";
import type { RequestError } from "./internal/transport.ts";

export interface RequestOptions {
  readonly requestId: string;
}
export interface StartOptions extends RequestOptions {
  readonly decisions?: Record<string, string>;
}
export interface RunOptions extends RequestOptions {
  readonly request: Protocol.RunRequest;
}
export interface CancelOptions extends RequestOptions {
  readonly runId: string;
}

/** Kernel identity and the availability of its output connection. */
export interface State {
  readonly runtime: Protocol.RuntimeOutput | null;
  readonly connection: "idle" | "connecting" | "connected" | "error";
  readonly canInteract: boolean;
  readonly error: Interaction.Error | null;
}

/**
 * Commands and read-only state for a notebook's runtime.
 *
 * ```ts
 * yield* notebook.runtime.setUIValues({ values: { "cell-0": 5 } });
 * const page = yield* notebook.runtime.invoke({
 *   namespace: "table",
 *   name: "fetch",
 *   args: { page: 1 },
 * });
 * ```
 */
export interface Interface {
  readonly state: Atom.Atom<State>;
  /** Subscribing acquires an attach-only connection; the last subscriber releases it. */
  readonly events: Stream.Stream<Interaction.Event, Interaction.Error>;
  /** Starts the notebook runtime. */
  readonly start: (
    options: StartOptions,
  ) => Effect.Effect<Protocol.RuntimeOutput, RequestError>;
  /** Runs the confirmed cells and etags in the request. */
  readonly run: (
    options: RunOptions,
  ) => Effect.Effect<Protocol.RunOutput, RequestError>;
  /** Cancels the run identified by `runId`. */
  readonly cancel: (
    options: CancelOptions,
  ) => Effect.Effect<Protocol.RunOutput, RequestError>;
  /** Interrupts work in the notebook runtime. */
  readonly interrupt: (
    options: RequestOptions,
  ) => Effect.Effect<Protocol.RuntimeOutput, RequestError>;
  /** Stops the notebook runtime. */
  readonly stop: (
    options: RequestOptions,
  ) => Effect.Effect<Protocol.RuntimeOutput, RequestError>;
  /** Updates controls without automatically retrying an uncertain write. */
  readonly setUIValues: (
    options: Interaction.UIValues,
  ) => Effect.Effect<void, Interaction.Error>;
  /** Waits for the matching kernel result, with a 30-second deadline. */
  readonly invoke: (
    options: Interaction.Invoke,
  ) => Effect.Effect<Interaction.Json, Interaction.Error>;
  /** Sends an anywidget model update or custom message, including binary buffers. */
  readonly sendWidgetMessage: (
    options: Interaction.WidgetMessage,
  ) => Effect.Effect<void, Interaction.Error>;
  /** Resolves a kernel-authored ./@file/ reference through the authenticated proxy. */
  readonly assetUrl: (path: string) => string;
  /** Reconnects output transport after credentials or host availability change. */
  readonly retry: Effect.Effect<void>;
}

type StartupObservation = Data.TaggedEnum<{
  Unseen: {};
  Present: { readonly runtime: Protocol.RuntimeOutput };
  Removed: {};
}>;
const StartupObservation = Data.taggedEnum<StartupObservation>();

/**
 * Reuses a running runtime, joins startup, or starts one and waits up to 60 seconds.
 * Returns false if the matching runtime is removed or terminates. Observation is
 * scoped to the caller, including cancellation and timeout.
 */
export function ensureRunning(notebook: Notebook.Interface) {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const observations = yield* Queue.unbounded<Notebook.State>();
    // Subscribe before starting: stream updates may precede the HTTP response.
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        registry.subscribe(
          notebook.state,
          (state) => {
            Queue.offerUnsafe(observations, state);
          },
          { immediate: true },
        ),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    const initial = registry.get(notebook.state);
    if (initial.error) return yield* Effect.fail(initial.error);
    if (initial.status === "closed")
      return yield* Effect.fail(new Error("The notebook connection closed."));
    const current = initial.value.runtime;
    if (current?.status === "running") return true;
    const started =
      current?.status === "starting"
        ? current
        : yield* notebook.runtime.start({ requestId: crypto.randomUUID() });
    let observed: StartupObservation = StartupObservation.Unseen();
    let pending = yield* Queue.takeAll(observations);
    while (true) {
      // Reconcile the whole buffered batch before accepting an older response.
      for (const state of pending) {
        if (state.error) return yield* Effect.fail(state.error);
        if (state.status === "closed")
          return yield* Effect.fail(new Error("The notebook connection closed."));
        const runtime = state.value.runtime;
        if (runtime?.id === started.id) {
          observed = StartupObservation.Present({ runtime });
        } else if (state.value.ready && observed._tag === "Present") {
          observed = StartupObservation.Removed();
        }
      }
      if (observed._tag === "Removed") return false;
      // A starting event may precede a more advanced command response.
      const runtime =
        observed._tag === "Present" && observed.runtime.status !== "starting"
          ? observed.runtime
          : started;
      switch (runtime.status) {
        case "running":
          return true;
        case "terminating":
          return false;
        case "failed":
          return yield* Effect.fail(
            new Error(runtime.message ?? "The runtime could not start."),
          );
        case "starting":
          pending = yield* Queue.takeAll(observations);
      }
    }
  }).pipe(Effect.scoped, Effect.timeout("60 seconds"));
}
