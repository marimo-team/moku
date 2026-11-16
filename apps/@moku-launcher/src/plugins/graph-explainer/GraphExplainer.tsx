import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import { empty } from "../empty.ts";
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
  const result = useAtomValue(notebook.state);
  const state = AsyncResult.getOrElse(result, () => empty);
  const ready = AsyncResult.isSuccess(result) && !result.waiting;
  const error = AsyncResult.isFailure(result) ? Cause.squash(result.cause) : null;

  const [selected, setSelected] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const run = newestRun(state);
  const active = run && run.status !== "completed";
  const actions = useRunActions(notebook, state, run, ready);
  const {
    actionKind,
    actionLabel,
    starting,
    disabledReason,
    actionError,
    action,
    runCell,
    cellRunDisabled,
  } = actions;
  let statusLabel: string = run?.outcome ?? run?.status ?? "Ready";
  if (starting) statusLabel = "Starting kernel";
  if (!ready)
    statusLabel = AsyncResult.isInitial(result) ? "Connecting" : "Disconnected";
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
          onAction={action}
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
            onRunCell={runCell}
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
