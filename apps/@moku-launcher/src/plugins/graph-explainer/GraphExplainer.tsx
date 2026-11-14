import * as Observation from "../observation.ts";
import * as React from "react";
import { useAtomValue } from "@effect/atom-react";
import type { ViewProps } from "@moku/plugin";
import { newestRun } from "./execution.ts";
import { useRunActions } from "./actions.ts";
import { GraphToolbar } from "./GraphToolbar.tsx";
import { RunLog } from "./RunLog.tsx";
import { CellDetails } from "./CellDetails.tsx";
import { DependencyGraph } from "./diagram/DependencyGraph.tsx";

export function GraphExplainer({ notebook }: ViewProps) {
  const {
    value: state,
    status,
    error,
    ready,
  } = Observation.read(useAtomValue(notebook.state));
  const [selected, setSelected] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const run = newestRun(state);
  const active = run && run.status !== "completed";
  const actions = useRunActions(notebook, state, run, status === "connected");
  const {
    actionKind,
    actionLabel,
    starting,
    disabledReason,
    actionError,
    action,
    cellRunDisabled,
  } = actions;
  let statusLabel: string = run?.outcome ?? run?.status ?? "Ready";
  if (starting) statusLabel = "Starting kernel";
  if (status !== "connected")
    statusLabel = status === "connecting" ? "Connecting" : "Disconnected";
  const message =
    (error instanceof Error ? error.message : "") ||
    actionError ||
    state.runtime?.message;
  return (
    <div className="dag">
      <section className={`run-view ${expanded ? "expanded" : ""}`}>
        <GraphToolbar
          runId={run?.id}
          statusLabel={statusLabel}
          active={!!active}
          starting={starting}
          actionKind={actionKind}
          actionLabel={actionLabel}
          disabledReason={disabledReason}
          onAction={() => action(actionKind)}
          expanded={expanded}
          onToggleExpanded={() => setExpanded(!expanded)}
        />
        {message && (
          <div className="error-banner" role="alert">
            {message}
          </div>
        )}
        {ready && !state.document?.order.length ? (
          <div className="empty-state">This notebook has no cells.</div>
        ) : (
          <DependencyGraph
            onRunCell={(cellId) => action("run", cellId)}
            runDisabled={cellRunDisabled}
            state={state}
            run={run}
            selected={selected}
            onSelect={setSelected}
          />
        )}
        <RunLog state={state} run={run} />
        {selected && (
          <CellDetails
            state={state}
            cellId={selected}
            onClose={() => setSelected("")}
          />
        )}
      </section>
    </div>
  );
}
