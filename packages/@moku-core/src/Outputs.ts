/** Select an execution's console, output, and outcome from notebook state. @module */
import type * as Notebook from "./Notebook.ts";
import type * as Protocol from "./Protocol.ts";

/** A sequenced text or media entry in an execution's console. */
export type Item = typeof Protocol.Console.Type;

interface Records {
  /** Console entries in sequence order. */
  readonly items: readonly Item[];
  /** Absent until the execution sets its output. Null media means it was cleared. */
  readonly output: typeof Protocol.Output.Type | null;
}

/** The output records and outcome for one execution. */
export interface Snapshot extends Records {
  /** Runtime that produced the execution, when known. */
  readonly runtimeId: string | null;
  /** How the execution ended, or null while pending or unavailable. */
  readonly outcome: typeof Protocol.ExecutionOutcome.Type | null;
}

/** Whether an execution has console entries, output media, or an outcome to show. */
export function hasContent({
  outcome,
  items,
  output,
}: Pick<Snapshot, "items" | "output" | "outcome">): boolean {
  return (
    items.length > 0 ||
    output?.media != null ||
    (outcome !== null && outcome.kind !== "succeeded")
  );
}

type State = Pick<Notebook.State, "executions" | "consoles" | "outputs">;

/** Group records by execution when selecting multiple results from one snapshot. */
export function index(
  state: Pick<State, "consoles" | "outputs">,
): ReadonlyMap<string, Records> {
  const grouped = new Map<string, { items: Item[]; output: Records["output"] }>();
  function records(id: string) {
    let found = grouped.get(id);
    if (!found) {
      found = { items: [], output: null };
      grouped.set(id, found);
    }
    return found;
  }
  for (const item of Object.values(state.consoles))
    records(item.execution_id).items.push(item);
  for (const output of Object.values(state.outputs))
    records(output.execution_id).output = output;
  for (const { items } of grouped.values()) items.sort((a, b) => a.seq - b.seq);
  return grouped;
}

/**
 * Select an execution's ordered console, latest output record, and terminal outcome.
 *
 * Records may arrive before the execution. Supply an index from the same snapshot
 * when selecting multiple executions.
 */
export function forExecution(
  state: State,
  executionId: string,
  indexed?: ReadonlyMap<string, Records>,
): Snapshot {
  const execution = state.executions[executionId];
  const records = indexed
    ? indexed.get(executionId)
    : {
        output: Object.values(state.outputs).find(
          (item) => item.execution_id === executionId,
        ),
        items: Object.values(state.consoles)
          .filter((item) => item.execution_id === executionId)
          .sort((a, b) => a.seq - b.seq),
      };
  return {
    runtimeId: execution?.runtime_id ?? null,
    outcome: execution?.state.status === "completed" ? execution.state.outcome : null,
    items: records?.items ?? [],
    output: records?.output ?? null,
  };
}
