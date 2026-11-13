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
    case "interrupted":
      return "Stopped";
    default:
      return "—";
  }
}

export function createGraphView(
  state: NotebookState,
  run: Protocol.RunOutput | undefined,
  layout: RailRow[],
  analysisCurrent: boolean,
) {
  const executions = Object.values(state.executions).filter(
    (execution) => !run || execution.run_id === run.id,
  );
  const byCell = new Map(executions.map((execution) => [execution.cell_id, execution]));
  const inputs = Object.values(state.inputs);
  const rows: GraphRow[] = layout.map((rail, index) => {
    const cell = state.cells[rail.id];
    const execution = byCell.get(rail.id);
    const status = cellStatus(cell, execution, inputs);
    const analysis = analysisCurrent ? state.analysis?.cells[cell.id] : undefined;
    const edited = !!execution && execution.code_fingerprint !== cell.code_fingerprint;
    return {
      ...rail,
      label: cellLabel(cell, index),
      status,
      progress: progressLabel(status),
      bindings: execution?.status === "completed" ? (analysis?.defs ?? []) : [],
      warning: edited ? "Code changed since execution" : analysis?.errors[0]?.message,
      edited,
      disabled: cell.config.disabled,
    };
  });

  const starts = executions.flatMap((execution) =>
    execution.started_at ? [Date.parse(execution.started_at)] : [],
  );
  const start = starts.length
    ? Math.min(...starts)
    : run?.started_at
      ? Date.parse(run.started_at)
      : Date.now();
  const completed = executions.flatMap((execution) =>
    execution.completed_at ? [Date.parse(execution.completed_at)] : [],
  );
  const end = Math.max(
    start,
    ...completed,
    run?.completed_at ? Date.parse(run.completed_at) : start,
  );
  const spans = Object.fromEntries(
    layout.map((row) => {
      const execution = byCell.get(row.id);
      const timing = executionSpan(execution, end);
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
  const live = !!run && run.status !== "completed";
  const timeline: TimelineInput = {
    runId: run?.id ?? "idle",
    start,
    end,
    live,
    following: live && starts.length > 0,
    spans,
  };
  const runningCount = executions.filter(
    (execution) => execution.status === "running",
  ).length;
  return { rows, timeline, runningCount };
}
