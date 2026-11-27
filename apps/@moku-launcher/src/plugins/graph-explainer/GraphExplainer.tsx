import { useAtomValue } from "@effect/atom-react";
import * as Notebook from "@moku/core/Notebook";
import type { ViewProps } from "@moku/plugin";
import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import * as React from "react";

import { empty } from "../empty.ts";
import { useRunActions } from "./actions.ts";
import { CellDetails } from "./CellDetails.tsx";
import { DependencyGraph } from "./diagram/DependencyGraph.tsx";
import { newestRun } from "./execution.ts";
import { GraphToolbar } from "./GraphToolbar.tsx";
import { RunLog } from "./RunLog.tsx";

export function GraphExplainer({ notebook }: ViewProps) {
  const result = useAtomValue(notebook.state);
  const state = AsyncResult.getOrElse(result, () => empty);
  const ready = AsyncResult.isSuccess(result) && !result.waiting;
  const error = AsyncResult.isFailure(result) ? Cause.squash(result.cause) : null;

  const [selected, setSelected] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const run = newestRun(state);
  const active = run && run.state.status !== "completed";
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
  let statusLabel: string =
    run?.state.status === "completed"
      ? run.state.outcome.kind
      : (run?.state.status ?? "Ready");
  if (starting) statusLabel = "Starting kernel";
  if (!ready)
    statusLabel = AsyncResult.isInitial(result) ? "Connecting" : "Disconnected";
  const message =
    (error instanceof Error ? error.message : "") ||
    actionError ||
    (run?.state.status === "completed" && run.state.outcome.kind === "failed"
      ? run.state.outcome.message
      : null) ||
    Notebook.runtimeMessage(state.runtime);
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
