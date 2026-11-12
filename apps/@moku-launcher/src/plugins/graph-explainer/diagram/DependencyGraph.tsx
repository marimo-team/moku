import * as React from "react";
import type * as Protocol from "@moku/core/Protocol";
import type { NotebookState } from "../execution.ts";
import * as Timeline from "../timeline/Timeline.tsx";
import { useTimeline } from "../timeline/useTimeline.ts";
import { dependencyGraph } from "./dependencies.ts";
import * as Graph from "./Graph.tsx";
import { GroupEditor } from "./GroupEditor.tsx";
import { useGroups } from "./useGroups.ts";
import { layoutView } from "./layout.ts";
import { createGraphView } from "./view.ts";

interface DependencyGraphProps {
  state: NotebookState;
  run: Protocol.RunOutput | undefined;
  selected: string;
  onSelect: (id: string) => void;
  groupKey: string;
  onRunCell: (id: string) => void;
  runDisabled: string;
}

export function DependencyGraph({
  state,
  run,
  selected,
  onSelect,
  groupKey,
  onRunCell,
  runDisabled,
}: DependencyGraphProps) {
  const graph = React.useMemo(
    () => dependencyGraph(state),
    [state.document, state.analysis, state.cells],
  );
  const [groups, setGroups] = useGroups(groupKey);
  const [editingGroups, setEditingGroups] = React.useState(false);
  const [closedGroups, setClosedGroups] = React.useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = React.useState(false);
  const [hovered, setHovered] = React.useState<string | null>(null);
  const layout = React.useMemo(
    () => layoutView(graph.order, graph.edges, groups, closedGroups),
    [graph, groups, closedGroups],
  );
  const view = React.useMemo(
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
        <GroupEditor
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
            <Timeline.Axis frame={timeline} axisRef={timeline.axisRef} />
            <div />
          </div>
          {!collapsed && (
            <div className="graph-body">
              <Graph.Rails
                rows={view.rows}
                edges={layout.edges}
                width={layout.width}
                hovered={hovered}
              />
              {view.rows.map((row) => (
                <Graph.Row
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
              <Timeline.Playhead position={timeline.playhead} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
