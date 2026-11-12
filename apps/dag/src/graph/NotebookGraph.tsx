import { useMemo, useState } from "react";
import type * as Protocol from "@marimo-team/client/protocol";
import type { NotebookState } from "../notebook/model.ts";
import { TimelineAxis, TimelinePlayhead } from "../timeline/Timeline.tsx";
import { useTimeline } from "../timeline/useTimeline.ts";
import { dependencyGraph } from "./dependencies.ts";
import { GraphRails } from "./GraphRails.tsx";
import { GraphRow } from "./GraphRow.tsx";
import { Groups, useViewGroups } from "./Groups.tsx";
import { layoutView } from "./layout.ts";
import { createGraphView } from "./view.ts";

interface NotebookGraphProps {
  state: NotebookState;
  run: Protocol.RunOutput | undefined;
  selected: string;
  onSelect: (id: string) => void;
  groupKey: string;
  onRunCell: (id: string) => void;
  runDisabled: string;
}

export function NotebookGraph({
  state,
  run,
  selected,
  onSelect,
  groupKey,
  onRunCell,
  runDisabled,
}: NotebookGraphProps) {
  const graph = useMemo(
    () => dependencyGraph(state),
    [state.document, state.analysis, state.cells],
  );
  const [groups, setGroups] = useViewGroups(groupKey);
  const [editingGroups, setEditingGroups] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const layout = useMemo(
    () => layoutView(graph.order, graph.edges, groups, closedGroups),
    [graph, groups, closedGroups],
  );
  const view = useMemo(
    () => createGraphView(state, run, layout.rows, graph.current),
    [state, run, layout.rows, graph.current],
  );
  const timeline = useTimeline(view.timeline);

  function toggleGroup(id: string) {
    setClosedGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {!graph.current && state.ready && (
        <div className="notice">
          {state.analysis
            ? "Waiting for the updated dependency graph…"
            : "Waiting for dependency analysis…"}
        </div>
      )}
      {editingGroups && (
        <Groups
          state={state}
          edges={graph.edges}
          groups={groups}
          onChange={setGroups}
          onClose={() => setEditingGroups(false)}
        />
      )}
      <div className="graph-scroll">
        <div className="notebook-graph">
          <div className="graph-head">
            <div className="graph-heading">
              <button
                className="graph-toggle"
                onClick={() => setCollapsed(!collapsed)}
                aria-expanded={!collapsed}
              >
                <span className="chevron">{collapsed ? "›" : "⌄"}</span> Notebook
                {view.runningCount > 0 && (
                  <span className="running-count">
                    <i className="spinner" />
                    {view.runningCount} running
                  </span>
                )}
              </button>
              <button
                className="groups-toggle"
                title="Name and organize notebook groups"
                onClick={() => setEditingGroups(!editingGroups)}
              >
                Groups
              </button>
            </div>
            <div>Progress</div>
            <TimelineAxis frame={timeline} axisRef={timeline.axisRef} />
            <div />
          </div>
          {!collapsed && (
            <div className="graph-body">
              <GraphRails
                rows={view.rows}
                edges={layout.edges}
                width={layout.width}
                hovered={hovered}
              />
              {view.rows.map((row) => (
                <GraphRow
                  key={row.id}
                  row={row}
                  selected={selected === row.id}
                  expanded={
                    row.kind === "group"
                      ? !closedGroups.has(row.id)
                      : selected === row.id
                  }
                  timeline={timeline}
                  runDisabled={runDisabled}
                  onHover={setHovered}
                  onRun={() => onRunCell(row.id)}
                  onActivate={() =>
                    row.kind === "group"
                      ? toggleGroup(row.id)
                      : onSelect(selected === row.id ? "" : row.id)
                  }
                />
              ))}
              <TimelinePlayhead position={timeline.playhead} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
