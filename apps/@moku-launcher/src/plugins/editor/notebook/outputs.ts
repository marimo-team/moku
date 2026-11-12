import type * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/Protocol";
import * as Outputs from "@moku/core/Outputs";

export type CellOutputs = Outputs.Snapshot;
export interface Selection {
  readonly runtimeId: string | null;
  readonly current: ReadonlyMap<string, Protocol.ExecutionOutput>;
  readonly results: ReadonlyMap<string, Protocol.ExecutionOutput>;
}
const time = (execution: Protocol.ExecutionOutput) => Date.parse(execution.started_at ?? execution.completed_at ?? "") || 0;

/** Retain the last result while a replacement execution is running. */
export function select(state: Notebook.Snapshot, previous?: Selection): Selection {
  const runtimeId = state.runtime?.id ?? null;
  const results = new Map(previous?.runtimeId === runtimeId ? previous.results : []);
  for (const id of results.keys()) if (!state.cells[id]) results.delete(id);
  const current = new Map<string, Protocol.ExecutionOutput>();
  for (const execution of Object.values(state.executions).sort((a, b) => time(a) - time(b))) {
    const id = execution.cell_id;
    if (id === null || !state.cells[id] || (runtimeId !== null && execution.runtime_id !== runtimeId)) continue;
    current.set(id, execution);
    if (execution.status !== "completed" || (execution.outcome?.kind === "skipped" && execution.outcome.reason === "superseded")) continue;
    const old = results.get(id);
    if (!old || time(execution) >= time(old)) results.set(id, execution);
  }
  return { runtimeId, current, results };
}

export function forCell(state: Notebook.Snapshot, selection: Selection, cellId: string): CellOutputs {
  const current = selection.current.get(cellId);
  const result = selection.results.get(cellId);
  const outputs = current ? Outputs.forExecution(state, current.id) : { runtimeId: result?.runtime_id ?? null, items: [], outcome: null };
  const outcome = current && current.status !== "completed" && current.outcome !== null
    ? current.outcome
    : current?.status === "running" && result?.outcome?.kind === "skipped"
      ? null : result?.outcome ?? null;
  return { ...outputs, outcome };
}

export function hasContent({ outcome, items }: CellOutputs): boolean {
  return items.length > 0 || (outcome !== null && (outcome.kind !== "value" || outcome.display !== null));
}
