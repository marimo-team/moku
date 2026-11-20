import * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/Protocol";
import * as Outputs from "@moku/core/Outputs";

export type CellOutputs = Outputs.Snapshot;
export interface Selection {
  readonly runtimeId: string | null;
  readonly current: ReadonlyMap<string, typeof Protocol.Execution.Type>;
  readonly results: ReadonlyMap<string, typeof Protocol.Execution.Type>;
  readonly resultOutputs: ReadonlyMap<string, typeof Protocol.Output.Type>;
  readonly outputs: ReturnType<typeof Outputs.index>;
}
/** Retain the last result while a replacement execution is running. */
export function select(state: Notebook.State, previous?: Selection): Selection {
  const cells = state.document && Notebook.cellIndex(state.document);
  const runtimeId = state.runtime?.id ?? null;
  const results = new Map(previous?.runtimeId === runtimeId ? previous.results : []);
  for (const id of results.keys()) if (!cells?.has(id)) results.delete(id);
  const current = new Map<string, typeof Protocol.Execution.Type>();
  for (const execution of Object.values(state.executions).sort(
    (a, b) => Notebook.executionTime(a) - Notebook.executionTime(b),
  )) {
    const id = execution.cell_id;
    if (
      id === null ||
      !cells?.has(id) ||
      (runtimeId !== null && execution.runtime_id !== runtimeId)
    )
      continue;
    const selected = current.get(id);
    // An active rerun takes precedence over a retained result.
    if (
      !selected ||
      selected.state.status === "completed" ||
      execution.state.status !== "completed"
    )
      current.set(id, execution);
    if (
      execution.state.status !== "completed" ||
      (execution.state.outcome.kind === "skipped" &&
        execution.state.outcome.reason === "superseded")
    )
      continue;
    const old = results.get(id);
    if (!old || Notebook.executionTime(execution) >= Notebook.executionTime(old))
      results.set(id, execution);
  }
  const outputs = Outputs.index(state);
  const resultOutputs = new Map<string, typeof Protocol.Output.Type>();
  // A host may retire the previous execution and its items before publishing the rerun.
  for (const result of results.values()) {
    const output =
      outputs.get(result.id)?.output ??
      (previous?.runtimeId === runtimeId
        ? previous.resultOutputs.get(result.id)
        : undefined);
    if (output) resultOutputs.set(result.id, output);
  }
  return { runtimeId, current, results, outputs, resultOutputs };
}

export function forCell(
  state: Notebook.State,
  selection: Selection,
  cellId: string,
): CellOutputs {
  const current = selection.current.get(cellId);
  const result = selection.results.get(cellId);
  const outputs = current
    ? Outputs.forExecution(state, current.id, selection.outputs)
    : { runtimeId: result?.runtime_id ?? null, items: [], outcome: null, output: null };
  if (
    !result ||
    result.state.status !== "completed" ||
    current?.id === result.id ||
    outputs.output
  )
    return outputs;
  return {
    ...outputs,
    output: selection.resultOutputs.get(result.id) ?? null,
    outcome:
      current?.state.status === "running" && result.state.outcome.kind === "skipped"
        ? null
        : result.state.outcome,
  };
}

export function hasContent({ outcome, items, output }: CellOutputs): boolean {
  return (
    items.length > 0 ||
    output?.media != null ||
    (outcome !== null && outcome.kind !== "succeeded")
  );
}
