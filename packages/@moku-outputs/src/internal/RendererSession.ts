/**
 * Define the embedded renderer's session contract for one producing runtime.
 *
 * Each session owns widget registrations and callbacks for a fixed runtime ID.
 * The connection supplies callbacks and releases the session when that runtime changes.
 *
 * @module
 */
import type { Schema } from "effect";
import type * as CommProtocol from "@moku/core/internal/comm-protocol";
import type { DisplayViewProps } from "../types.ts";

/** Runtime-bound callbacks installed into the marimo renderer's registries. */
export interface Options {
  /** The runtime whose outputs may use this session. */
  readonly runtimeId: string;
  /** Resolves kernel-authored asset references through the authenticated proxy. */
  readonly assetUrl: (path: string) => string;
  /** Submits paired UI element IDs and values, resolving on host acceptance. */
  readonly sendComponentValues: (
    request: typeof CommProtocol.ComponentValues.Type,
  ) => Promise<void>;
  /** Resolves with the function's result after its reply arrives on the runtime event stream. */
  readonly invoke: (
    request: typeof CommProtocol.FunctionCall.Type,
  ) => Promise<typeof Schema.Json.Type>;
  /** Submits a widget state patch or custom message with its binary attachments. */
  readonly sendModelValue: (
    request: typeof CommProtocol.ModelValue.Type,
  ) => Promise<void>;
}

/** Renderer registrations owned by one runtime and released together. */
export interface Interface {
  /** The runtime whose widget IDs and callbacks belong to this session. */
  readonly runtimeId: string;
  /** Resolves asset references for outputs belonging to this session. */
  readonly assetUrl: (path: string) => string;
  /** Applies a notification to the renderer's UI and widget registries. */
  readonly handle: (notification: CommProtocol.Notification) => Promise<void>;
  /** Releases registries and listeners; repeated calls are harmless. */
  readonly dispose: () => void;
}

/** Output content with the renderer session available to its widgets. */
export interface DisplayProps extends DisplayViewProps {
  /** Missing or mismatched sessions leave runtime-bound outputs disconnected. */
  readonly session?: Interface | null;
}
