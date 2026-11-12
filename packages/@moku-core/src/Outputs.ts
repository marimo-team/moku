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
  readonly runtimeId: string | null;
  readonly outcome: Protocol.OutcomeOutput | null;
  readonly items: readonly Item[];
}

/** Group output records once when selecting multiple executions from a snapshot. */
export function index(
  state: Pick<Notebook.Snapshot, "consoles" | "displays">,
): ReadonlyMap<string, readonly Item[]> {
  return collect(state);
}

function collect(
  state: Pick<Notebook.Snapshot, "consoles" | "displays">,
  executionId?: string,
) {
  const grouped = new Map<string, Item[]>();
  function add(item: Item) {
    const items = grouped.get(item.execution_id);
    if (items) items.push(item);
    else grouped.set(item.execution_id, [item]);
  }
  for (const display of Object.values(state.displays)) {
    if (executionId === undefined || display.execution_id === executionId)
      add({ kind: "display", ...display });
  }
  for (const console of Object.values(state.consoles)) {
    if (executionId === undefined || console.execution_id === executionId)
      add({ kind: "console", ...console });
  }
  for (const items of grouped.values()) items.sort((a, b) => a.seq - b.seq);
  return grouped;
}

/**
 * Selects an execution's output records in sequence order.
 *
 * Only records currently present in `state` are returned. An unknown execution
 * has a null outcome; any display or console records matching its ID are still
 * included. The input state is unchanged.
 * Pass an index built from the same snapshot when selecting multiple executions.
 */
export function forExecution(
  state: Pick<Notebook.Snapshot, "executions" | "consoles" | "displays">,
  executionId: string,
  indexed: ReadonlyMap<string, readonly Item[]> = collect(state, executionId),
): Snapshot {
  return {
    runtimeId: state.executions[executionId]?.runtime_id ?? null,
    outcome: state.executions[executionId]?.outcome ?? null,
    items: indexed.get(executionId) ?? [],
  };
}
