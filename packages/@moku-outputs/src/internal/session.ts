/**
 * Bind the embedded renderer's callbacks to one producing runtime.
 *
 * The output bridge runs channel Effects at this Promise-based renderer boundary.
 * Runtime identity stays fixed for the session so historical widgets cannot send
 * requests to a replacement kernel.
 *
 * @module
 */
import type * as Interaction from "@moku/core/Interaction";
import type { DisplayViewProps } from "../types.ts";

/** Runtime-bound callbacks installed into the native renderer's registries. */
export interface SessionOptions {
  /** The runtime whose outputs may use this session. */
  readonly runtimeId: string;
  /** Resolves kernel-authored asset references through the authenticated proxy. */
  readonly assetUrl: (path: string) => string;
  /** Submits paired UI element IDs and values, resolving on host acceptance. */
  readonly sendComponentValues: (
    request: typeof Interaction.ComponentValues.Type,
  ) => Promise<void>;
  /** Resolves with the function's result after its reply arrives on the native stream. */
  readonly invoke: (
    request: Omit<Interaction.Invoke, "runtimeId">,
  ) => Promise<Interaction.Json>;
  /** Submits a widget state patch or custom message with its binary attachments. */
  readonly sendModelValue: (
    request: typeof Interaction.ModelValue.Type,
  ) => Promise<void>;
}

/** Native renderer registrations owned by one runtime and released together. */
export interface Session {
  /** The runtime whose widget IDs and callbacks belong to this session. */
  readonly runtimeId: string;
  /** Resolves asset references for outputs belonging to this session. */
  readonly assetUrl: (path: string) => string;
  /** Applies a notification to the renderer's UI and widget registries. */
  readonly handle: (notification: Interaction.Notification) => Promise<void>;
  /** Releases registries and listeners; repeated calls are harmless. */
  readonly dispose: () => void;
}

/** Output content with the native session and permissions available to its widgets. */
export interface DisplayRendererProps extends DisplayViewProps {
  /** Missing or mismatched sessions leave runtime-bound outputs disconnected. */
  readonly session?: Session | null;
  /** Whether a connected widget may interact; defaults to false. */
  readonly canInteract?: boolean;
}
