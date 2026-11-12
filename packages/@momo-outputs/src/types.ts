/**
 * Component props derived from the marimo output protocol.
 *
 * @module
 */
import type * as Protocol from "@momo/model/Protocol";
import type * as Outputs from "@momo/model/Outputs";

/**
 * A MIME type and its encoded payload from the host.
 *
 * JSON is encoded as text. Embedded binary media is base64; data URLs and
 * inline SVG are also accepted by the renderer.
 */
export type DisplayData = Protocol.DisplayDataOutput;
export type ConsoleChunk = Protocol.ConsoleOutput;
export type Outcome = Protocol.OutcomeOutput;
export type OutputItem = Outputs.Item;
export type Theme = "light" | "dark";

export interface DisplayViewProps {
  /** The runtime that produced this output; required for interaction. */
  readonly runtimeId?: string | null;
  readonly data: DisplayData;
  readonly className?: string;
}

export interface ConsoleOutputProps {
  readonly chunks: readonly ConsoleChunk[];
  readonly className?: string;
}

export interface CellOutputsProps extends Omit<Outputs.Snapshot, "runtimeId"> {
  readonly runtimeId?: string | null;
  readonly className?: string;
}
