import { useMemo } from "react";
import type { CellStatus } from "../notebook/model.ts";
import { connectionPriority, connectionTone } from "./connections.ts";
import { ROW_HEIGHT, type RailEdge } from "./layout.ts";
import type { GraphRow } from "./view.ts";

interface GraphRailsProps {
  rows: GraphRow[];
  edges: RailEdge[];
  width: number;
  hovered: string | null;
}

function nodeRadius(status: CellStatus) {
  if (status === "running" || status === "waiting") return 4.5;
  return status === "succeeded" ? 2.5 : 3.5;
}

export function GraphRails({ rows, edges, width, hovered }: GraphRailsProps) {
  const connections = useMemo(() => {
    const statuses = new Map(rows.map((row) => [row.id, row.status]));
    return edges
      .map((edge) => ({
        ...edge,
        tone: connectionTone(statuses.get(edge.from)!, statuses.get(edge.to)!),
        hover: edge.from === hovered || edge.to === hovered,
      }))
      .sort((a, b) => connectionPriority(a.tone, a.hover) - connectionPriority(b.tone, b.hover));
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
