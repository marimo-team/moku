import type * as Protocol from "@momo/model/Protocol";
import {
  cellLabel,
  cellStatus,
  executionSpan,
  type CellStatus,
  type NotebookState,
} from "../notebook/model.ts";
import type { TimelineInput } from "../timeline/animation.ts";
import type { RailRow } from "./layout.ts";

export interface GraphRow extends Omit<RailRow, "label"> {
  kind: "cell" | "group";
  label: string;
  status: CellStatus;
  progress: string;
  bindings: string[];
  warning?: string;
  edited: boolean;
  disabled: boolean;
}

function groupStatus(statuses: CellStatus[]): CellStatus {
  for (const status of [
    "running",
    "waiting",
    "queued",
    "failed",
    "interrupted",
  ] as const) {
    if (statuses.includes(status)) return status;
  }
  if (statuses.every((status) => status === "succeeded" || status === "skipped")) {
    return statuses.includes("succeeded") ? "succeeded" : "skipped";
  }
  return statuses.every((status) => status === "disabled") ? "disabled" : "pending";
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
    const isGroup = rail.label !== undefined;
    const cell = isGroup ? undefined : state.cells[rail.id];
    const execution = cell ? byCell.get(cell.id) : undefined;
    const members = rail.members.flatMap((id) =>
      byCell.has(id) ? [byCell.get(id)!] : [],
    );
    const status = groupStatus(
      rail.members.map((id) => cellStatus(state.cells[id], byCell.get(id), inputs)),
    );
    const analysis =
      cell && analysisCurrent ? state.analysis?.cells[cell.id] : undefined;
    const edited = !!execution && execution.code_fingerprint !== cell?.code_fingerprint;
    return {
      ...rail,
      kind: isGroup ? "group" : "cell",
      label: cell ? cellLabel(cell, index) : rail.label!,
      status,
      progress: isGroup
        ? `${members.filter((member) => member.status === "completed").length} / ${rail.members.length}`
        : progressLabel(status),
      bindings: execution?.status === "completed" ? (analysis?.defs ?? []) : [],
      warning: edited ? "Code changed since execution" : analysis?.errors[0]?.message,
      edited,
      disabled: cell?.config.disabled ?? false,
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
      const members = row.members.flatMap((id) =>
        byCell.has(id) ? [byCell.get(id)!] : [],
      );
      const timing = executionSpan(members, end);
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
