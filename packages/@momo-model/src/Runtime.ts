/**
 * Execution and output interactions owned by a notebook.
 *
 * The namespace survives kernel restarts. Output requests may name their
 * producing runtime so stale controls cannot operate on its replacement.
 *
 * @module
 */
import type { Effect, Stream } from "effect";
import type { Atom } from "effect/reactivity";
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
