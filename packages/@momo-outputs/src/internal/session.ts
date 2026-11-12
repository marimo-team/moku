/**
 * The small interface between model transport and the embedded renderer.
 *
 * @module
 */
import type * as Interaction from "@momo/model/Interaction";
import type { DisplayViewProps } from "../types.ts";

export interface SessionOptions {
  readonly runtimeId: string;
  readonly assetUrl: (path: string) => string;
  readonly sendComponentValues: (
    request: typeof Interaction.ComponentValues.Type,
  ) => Promise<void>;
  readonly invoke: (
    request: Omit<Interaction.Invoke, "runtimeId">,
  ) => Promise<Interaction.Json>;
  readonly sendModelValue: (
    request: typeof Interaction.ModelValue.Type,
  ) => Promise<void>;
}

export interface Session {
  readonly runtimeId: string;
  readonly assetUrl: (path: string) => string;
  readonly handle: (notification: Interaction.Notification) => Promise<void>;
  readonly dispose: () => void;
}

export interface DisplayRendererProps extends DisplayViewProps {
  readonly session?: Session | null;
  readonly canInteract?: boolean;
}
