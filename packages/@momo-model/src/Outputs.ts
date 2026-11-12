/**
 * Select display data, console chunks, and outcomes from notebook state.
 *
 * @module
 */
import type * as Notebook from "./Notebook.ts";
import type * as Protocol from "./Protocol.ts";

/**
 * A display or console record, distinguished by `kind`.
 */
export type Item =
  | ({ readonly kind: "display" } & Protocol.DisplayOutput)
  | ({ readonly kind: "console" } & Protocol.ConsoleOutput);

/**
 * The outcome and ordered output records for one execution.
 */
export interface Snapshot {
  readonly outcome: Protocol.OutcomeOutput | null;
  readonly items: readonly Item[];
}

/**
 * Selects an execution's output records in sequence order.
 *
 * Only records currently present in `state` are returned. An unknown execution
 * has a null outcome; any display or console records matching its ID are still
 * included. The input state is unchanged.
 */
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
