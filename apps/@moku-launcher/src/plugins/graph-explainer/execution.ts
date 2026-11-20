import type * as Protocol from "@moku/core/Protocol";
import type { State as NotebookState } from "@moku/core/Notebook";
export type { NotebookState };

export type CellStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled"
  | "disabled"
  | "waiting";

export function cellStatus(
  cell: typeof Protocol.Cell.Type,
  execution: typeof Protocol.Execution.Type | undefined,
  inputs: (typeof Protocol.Input.Type)[],
): CellStatus {
  if (!execution) return cell.config.disabled ? "disabled" : "pending";
  if (
    execution.state.status === "running" &&
    inputs.some(
      (input) => input.execution_id === execution.id && input.status === "pending",
    )
  )
    return "waiting";
  if (execution.state.status !== "completed") return execution.state.status;
  return execution.state.outcome.kind;
}

export function cellLabel(cell: typeof Protocol.Cell.Type, index: number) {
  if (cell.name !== "_") return cell.name.replaceAll("_", " ");
  const line = cell.code?.split("\n").find((line) => line.trim());
  if (line?.trim().startsWith("#")) return line.trim().replace(/^#+\s*/, "");
  return line?.trim().slice(0, 72) || `Cell ${index + 1}`;
}

export function duration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function newestRun(state: NotebookState) {
  return Object.values(state.runs).sort((a, b) => {
    if (a.state.status !== "completed" && b.state.status === "completed") return -1;
    if (b.state.status !== "completed" && a.state.status === "completed") return 1;
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  })[0];
}

export function executionSpan(
  state: typeof Protocol.ExecutionState.Type | undefined,
  now: number,
) {
  if (!state || state.status === "queued" || !state.started_at) return null;
  const start = Date.parse(state.started_at);
  const end =
    state.status === "running"
      ? now
      : state.completed_at
        ? Date.parse(state.completed_at)
        : start;
  return {
    start,
    duration: Math.max(0, end - start),
    open: state.status === "running",
  };
}
