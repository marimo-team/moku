import type * as Protocol from "@momo/model/Protocol";
import type * as Outputs from "@momo/model/Outputs";

export type DisplayData = Protocol.DisplayDataOutput;
export type ConsoleChunk = Protocol.ConsoleOutput;
export type Outcome = Protocol.OutcomeOutput;
export type OutputItem = Outputs.Item;
export type Theme = "light" | "dark";

export interface DisplayViewProps {
  readonly data: DisplayData;
  readonly className?: string;
}

export interface ConsoleOutputProps {
  readonly chunks: readonly ConsoleChunk[];
  readonly className?: string;
}

export interface CellOutputsProps extends Outputs.Snapshot {
  readonly className?: string;
}
