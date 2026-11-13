/** Rows and dependency rails for a notebook execution graph. @module */
import * as React from "react";
import type { TimelineFrame } from "../timeline/animation.ts";
import * as Timeline from "../timeline/Timeline.tsx";
import type { CellStatus } from "../execution.ts";
import { connectionPriority, connectionTone } from "./connections.ts";
import { ROW_HEIGHT, type RailEdge } from "./layout.ts";
import type { GraphRow as RowState } from "./view.ts";

interface RowProps {
  row: RowState;
  selected: boolean;
  expanded: boolean;
  timeline: TimelineFrame;
  runDisabled: string;
  onActivate: () => void;
  onHover: (id: string | null) => void;
  onRun: () => void;
}

export function Row({
  row,
  selected,
  expanded,
  timeline,
  runDisabled,
  onActivate,
  onHover,
  onRun,
}: RowProps) {
  const rerunTitle =
    runDisabled || (row.disabled ? "This cell is disabled" : `Rerun ${row.label}`);
  return (
    <div className="graph-row-wrap">
      <button
        className={`graph-row ${row.status} ${selected ? "selected" : ""}`}
        onMouseEnter={() => onHover(row.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(row.id)}
        onBlur={() => onHover(null)}
        onClick={onActivate}
        aria-expanded={expanded}
        title={`${row.label} · ${row.status}${row.edited ? " · Code changed" : ""}`}
      >
        <div className="cell-label" style={{ paddingLeft: row.labelX }}>
          <strong>{row.label}</strong>
          {row.bindings.length > 0 && (
            <span className="cell-bindings">
              <span className="variable-icon">▤</span> {row.bindings.join(", ")}
            </span>
          )}
          {row.warning && (
            <span className="warning" title={row.warning}>
              ⚠
            </span>
          )}
        </div>
        <div className="progress-value">{row.progress}</div>
        <Timeline.Bar
          frame={timeline}
          timing={timeline.rows[row.id]}
          status={row.status}
        />
      </button>
      <button
        className="cell-rerun"
        aria-label={`Rerun ${row.label}`}
        title={rerunTitle}
        disabled={!!runDisabled || row.disabled}
        onClick={onRun}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20 7v5h-5M20 12a8 8 0 1 0-2.34 5.66"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

interface RailsProps {
  rows: RowState[];
  edges: RailEdge[];
  width: number;
  hovered: string | null;
}

function nodeRadius(status: CellStatus) {
  if (status === "running" || status === "waiting") return 4.5;
  return status === "succeeded" ? 2.5 : 3.5;
}

export function Rails({ rows, edges, width, hovered }: RailsProps) {
  const connections = React.useMemo(() => {
    const statuses = new Map(rows.map((row) => [row.id, row.status]));
    return edges
      .map((edge) => ({
        ...edge,
        tone: connectionTone(statuses.get(edge.from)!, statuses.get(edge.to)!),
        hover: edge.from === hovered || edge.to === hovered,
      }))
      .sort(
        (a, b) =>
          connectionPriority(a.tone, a.hover) - connectionPriority(b.tone, b.hover),
      );
  }, [rows, edges, hovered]);
  return (
    <svg
      className="dependencies"
      width={width}
      height={rows.length * ROW_HEIGHT}
      aria-label="Cell dependencies"
    >
      {connections.map((edge) => (
        <g
          key={`${edge.from}:${edge.to}`}
          className={`connection ${edge.tone} ${edge.hover ? "hovered" : ""} ${edge.feedback ? "feedback" : ""}`}
        >
          <path className="edge" d={edge.path} />
          <path className="arrow-head" d={edge.arrow} />
          <title>{edge.names.join(", ")}</title>
        </g>
      ))}
      {rows.map((row, index) => (
        <g
          key={row.id}
          className={`graph-node ${row.status}`}
          transform={`translate(${row.x},${index * ROW_HEIGHT + ROW_HEIGHT / 2})`}
        >
          <circle r={nodeRadius(row.status)} />
          {(row.status === "skipped" || row.status === "disabled") && (
            <path d="M-2.8 -2.8 L2.8 2.8" />
          )}
        </g>
      ))}
    </svg>
  );
}
