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
  | "interrupted"
  | "disabled"
  | "waiting";

export function cellStatus(
  cell: Protocol.CellOutput,
  execution: Protocol.ExecutionOutput | undefined,
  inputs: Protocol.InputOutput[],
): CellStatus {
  if (!execution) return cell.config.disabled ? "disabled" : "pending";
  if (
    execution.status === "running" &&
    inputs.some(
      (input) => input.execution_id === execution.id && input.status === "pending",
    )
  )
    return "waiting";
  if (execution.status !== "completed") return execution.status;
  switch (execution.outcome?.kind) {
    case "value":
      return "succeeded";
    case "error":
      return "failed";
    case "skipped":
      return "skipped";
    case "interrupted":
      return "interrupted";
    default:
      return "pending";
  }
}

export function cellLabel(cell: Protocol.CellOutput, index: number) {
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
    if (a.status !== "completed" && b.status === "completed") return -1;
    if (b.status !== "completed" && a.status === "completed") return 1;
    return (
      Date.parse(b.started_at ?? b.completed_at ?? "") -
      Date.parse(a.started_at ?? a.completed_at ?? "")
    );
  })[0];
}

export function executionSpan(
  execution: Pick<Protocol.ExecutionOutput, "started_at" | "completed_at"> | undefined,
  now: number,
) {
  if (!execution?.started_at) return null;
  const start = Date.parse(execution.started_at);
  const end = execution.completed_at ? Date.parse(execution.completed_at) : now;
  return {
    start,
    duration: Math.max(0, end - start),
    open: execution.completed_at === null,
  };
}
