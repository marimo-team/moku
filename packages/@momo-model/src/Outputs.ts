import type * as Notebook from "./Notebook.ts";
import type * as Protocol from "./Protocol.ts";

export type Item =
  | ({ readonly kind: "display" } & Protocol.DisplayOutput)
  | ({ readonly kind: "console" } & Protocol.ConsoleOutput);

export interface Snapshot {
  readonly outcome: Protocol.OutcomeOutput | null;
  readonly items: readonly Item[];
}

export function forExecution(
  state: Pick<Notebook.Snapshot, "executions" | "consoles" | "displays">,
  executionId: string,
): Snapshot {
  const items: Item[] = [];
  for (const display of Object.values(state.displays)) {
    if (display.execution_id === executionId) {
      items.push({ kind: "display", ...display });
    }
  }
  for (const console of Object.values(state.consoles)) {
    if (console.execution_id === executionId) {
      items.push({ kind: "console", ...console });
    }
  }
  items.sort((a, b) => a.seq - b.seq);

  return { outcome: state.executions[executionId]?.outcome ?? null, items };
}
