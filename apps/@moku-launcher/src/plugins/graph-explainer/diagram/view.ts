import type * as Protocol from "@moku/core/Protocol";
import {
  cellLabel,
  cellStatus,
  executionSpan,
  type CellStatus,
  type NotebookState,
} from "../execution.ts";
import type { TimelineInput } from "../timeline/animation.ts";
import type { RailRow } from "./layout.ts";

export interface GraphRow extends RailRow {
  label: string;
  status: CellStatus;
  progress: string;
  bindings: string[];
  warning?: string;
  edited: boolean;
  disabled: boolean;
}

function progressLabel(status: CellStatus) {
  switch (status) {
    case "failed":
      return "Failed";
    case "waiting":
      return "Input";
    case "cancelled":
      return "Stopped";
    default:
      return "—";
  }
}

export function createGraphView(
  state: NotebookState,
  run: typeof Protocol.Run.Type | undefined,
  layout: RailRow[],
  analysisCurrent: boolean,
) {
  const executions = Object.values(state.executions).filter(
    (execution) => !run || execution.run_id === run.id,
  );
  const byCell = new Map<string, typeof Protocol.Execution.Type>(
    executions.flatMap((execution) =>
      execution.cell_id === null ? [] : [[execution.cell_id, execution] as const],
    ),
  );
  const inputs = Object.values(state.inputs);
  const rows: GraphRow[] = layout.map((rail, index) => {
    const cell = state.document?.cells.find((cell) => cell.id === rail.id);
    if (!cell) throw new Error("The graph references a missing cell.");
    const execution = byCell.get(rail.id);
    const status = cellStatus(cell, execution, inputs);
    const analysis = analysisCurrent ? state.analysis?.cells[cell.id] : undefined;
    const edited = !!execution && execution.code_fingerprint !== cell.code_fingerprint;
    return {
      ...rail,
      label: cellLabel(cell, index),
      status,
      progress: progressLabel(status),
      bindings:
        execution?.state.status === "completed" ? [...(analysis?.defs ?? [])] : [],
      warning: edited
        ? "Code changed since execution"
        : analysis?.diagnostics.find(
            (d) => d.severity === "error" || d.severity === "warning",
          )?.message,
      edited,
      disabled: cell.config.disabled,
    };
  });

  const starts = executions.flatMap((execution) =>
    execution.state.status !== "queued" && execution.state.started_at
      ? [Date.parse(execution.state.started_at)]
      : [],
  );
  const start = starts.length
    ? Math.min(...starts)
    : run && run.state.status !== "queued" && run.state.started_at
      ? Date.parse(run.state.started_at)
      : Date.now();
  const completed = executions.flatMap((execution) =>
    execution.state.status === "completed" && execution.state.completed_at
      ? [Date.parse(execution.state.completed_at)]
      : [],
  );
  const end = Math.max(
    start,
    ...completed,
    run?.state.status === "completed" ? Date.parse(run.state.completed_at) : start,
  );
  const spans = Object.fromEntries(
    layout.map((row) => {
      const execution = byCell.get(row.id);
      const timing = executionSpan(execution?.state, end);
      return [
        row.id,
        timing
          ? {
              start: timing.start,
              end: timing.start + timing.duration,
              open: timing.open,
            }
          : null,
      ];
    }),
  );
  const live = !!run && run.state.status !== "completed";
  const timeline: TimelineInput = {
    runId: run?.id ?? "idle",
    start,
    end,
    live,
    following: live && starts.length > 0,
    spans,
  };
  const runningCount = executions.filter(
    (execution) => execution.state.status === "running",
  ).length;
  return { rows, timeline, runningCount };
}
