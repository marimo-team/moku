import type { TimelineFrame } from "../timeline/animation.ts";
import { TimelineCell } from "../timeline/Timeline.tsx";
import type { GraphRow as Row } from "./view.ts";

interface GraphRowProps {
  row: Row;
  selected: boolean;
  expanded: boolean;
  timeline: TimelineFrame;
  runDisabled: string;
  onActivate: () => void;
  onHover: (id: string | null) => void;
  onRun: () => void;
}

export function GraphRow({
  row,
  selected,
  expanded,
  timeline,
  runDisabled,
  onActivate,
  onHover,
  onRun,
}: GraphRowProps) {
  const isGroup = row.kind === "group";
  const rerunTitle = runDisabled || (row.disabled ? "This cell is disabled" : `Rerun ${row.label}`);
  return (
    <div className="graph-row-wrap">
      <button
        className={`graph-row ${row.status} ${row.depth ? "child-row" : ""} ${selected ? "selected" : ""}`}
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
          {isGroup && <span className="row-chevron">{expanded ? "⌄" : "›"}</span>}
        </div>
        <div className="progress-value">{row.progress}</div>
        <TimelineCell frame={timeline} timing={timeline.rows[row.id]} status={row.status} />
      </button>
      {!isGroup && (
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
      )}
    </div>
  );
}
