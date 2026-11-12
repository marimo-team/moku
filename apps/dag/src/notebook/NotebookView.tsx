import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type * as Notebook from "@momo/model/Notebook";
import { notebookAtom } from "../app/runtime.ts";
import { newestRun } from "./model.ts";
import { useRunActions } from "./useRunActions.ts";
import { RunLog } from "./RunLog.tsx";
import { CellDetails } from "./CellDetails.tsx";
import { NotebookGraph } from "../graph/NotebookGraph.tsx";

export function NotebookView({
  connectionId,
  id,
  name,
}: {
  connectionId: string;
  id: string;
  name: string;
}) {
  const attachment = useAtomValue(notebookAtom({ connectionId, notebookId: id }));
  if (!AsyncResult.isSuccess(attachment))
    return <div className="empty-state">Connecting to notebook…</div>;
  return <AttachedNotebook notebook={attachment.value} name={name} />;
}

function AttachedNotebook({
  notebook,
  name,
}: {
  notebook: Notebook.Handle;
  name: string;
}) {
  const { value: state, status, error } = useAtomValue(notebook.state);
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState(false);
  const run = newestRun(state);
  const active = run && run.status !== "completed";
  const actions = useRunActions(notebook, state, run, status === "connected");
  const {
    actionKind,
    actionLabel,
    disabledReason,
    actionError,
    action,
    cellRunDisabled,
  } = actions;
  let statusLabel: string = run?.outcome ?? run?.status ?? "Ready";
  if (status !== "connected")
    statusLabel = status === "connecting" ? "Connecting" : "Disconnected";
  const message = error?.message || actionError || state.runtime?.message;
  return (
    <section className={`run-view ${expanded ? "expanded" : ""}`}>
      <header className="run-header">
        <div className="run-name">
          <strong>{name.replace(/\.py$/, "")}</strong>
          <span>
            {run ? `Run ${run.id.replace(/^run-/, "").slice(0, 8)}` : "No run yet"}
          </span>
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
              disabledReason
                ? `${actionLabel}: ${disabledReason}`
                : `${actionLabel} notebook`
            }
          >
            {actionKind === "cancel" ? "■" : "▷"} <span>{actionLabel}</span>
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
          groupKey={`dag:groups:${encodeURIComponent(notebook.target.connectionId)}:${encodeURIComponent(notebook.target.notebookId)}`}
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
          run={run}
          onClose={() => setSelected("")}
        />
      )}
    </section>
  );
}
