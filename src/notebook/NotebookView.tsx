import { useState } from "react";
import type { Client } from "@marimo-team/client";
import { useNotebook } from "./connection.ts";
import { newestRun } from "./model.ts";
import { useRunActions } from "./useRunActions.ts";
import { RunLog } from "./RunLog.tsx";
import { CellDetails } from "./CellDetails.tsx";
import { NotebookGraph } from "../graph/NotebookGraph.tsx";

export function NotebookView({
  client,
  id,
  name,
}: {
  client: Client | null;
  id: string;
  name: string;
}) {
  const { notebook, state, status, error } = useNotebook(client, id);
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState(false);
  const run = newestRun(state);
  const active = run && run.status !== "completed";
  const actions = useRunActions(notebook, state, run);
  const { actionKind, actionLabel, disabledReason, actionError, action, cellRunDisabled } = actions;
  let statusLabel: string = run?.outcome ?? run?.status ?? "Ready";
  if (status !== "connected") statusLabel = status === "connecting" ? "Connecting" : "Disconnected";
  const message = error || actionError || state.runtime?.message;
  return (
    <section className={`run-view ${expanded ? "expanded" : ""}`}>
      <header className="run-header">
        <div className="run-name">
          <strong>{name.replace(/\.py$/, "")}</strong>
          <span>{run ? `Run ${run.id.replace(/^run-/, "").slice(0, 8)}` : "No run yet"}</span>
        </div>
        <div className="run-tools">
          <span className={`run-status ${statusLabel}`}>
            {active && <i className="spinner" />}
            {statusLabel}
          </span>
          <button
            className="run-button"
            disabled={!!disabledReason}
            onClick={() => void action(actionKind)}
            title={disabledReason || `${actionLabel} notebook`}
            aria-label={
              disabledReason ? `${actionLabel}: ${disabledReason}` : `${actionLabel} notebook`
            }
          >
            {actionKind === "interrupt" ? "■" : "▷"} <span>{actionLabel}</span>
          </button>
          <button
            className="icon-button"
            title={expanded ? "Exit expanded view" : "Expand view"}
            aria-label="Expand view"
            onClick={() => setExpanded(!expanded)}
          >
            ⤢
          </button>
        </div>
      </header>
      {message && (
        <div className="error-banner" role="alert">
          {message}
        </div>
      )}
      {state.ready && !state.document?.order.length ? (
        <div className="empty-state">This notebook has no cells.</div>
      ) : (
        <NotebookGraph
          onRunCell={(cellId) => void action("run", cellId)}
          runDisabled={cellRunDisabled}
          groupKey={`dag:groups:${id}`}
          state={state}
          run={run}
          selected={selected}
          onSelect={setSelected}
        />
      )}
      <RunLog state={state} run={run} />
      {selected && (
        <CellDetails state={state} cellId={selected} run={run} onClose={() => setSelected("")} />
      )}
    </section>
  );
}
