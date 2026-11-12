import { useState } from "react";
import type * as Protocol from "@momo/model/Protocol";
import { cellLabel, type NotebookState } from "./model.ts";

import { CellOutput } from "./CellOutput.tsx";

export function CellDetails({
  state,
  cellId,
  run,
  onClose,
}: {
  state: NotebookState;
  cellId: string;
  run: Protocol.RunOutput | undefined;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("Source");
  const cell = state.cells[cellId];
  if (!cell) return null;
  const execution = Object.values(state.executions).find(
    (e) => e.cell_id === cellId && (!run || e.run_id === run.id),
  );
  const logs = Object.values(state.consoles)
    .filter((c) => c.execution_id === execution?.id)
    .sort((a, b) => a.seq - b.seq);
  const displays = Object.values(state.displays)
    .filter((d) => d.execution_id === execution?.id)
    .sort((a, b) => a.seq - b.seq);
  const variables = Object.values(state.variables).filter(
    (v) => v.execution_id === execution?.id,
  );
  const analysis =
    state.analysis?.document_etag === state.document?.etag
      ? state.analysis?.cells[cellId]
      : undefined;
  const pending = Object.values(state.inputs).filter(
    (i) => i.execution_id === execution?.id && i.status === "pending",
  );
  return (
    <aside className="details">
      <div className="details-title">
        <div>
          <span className="eyebrow">CELL DETAILS</span>
          <h2>{cellLabel(cell, 0)}</h2>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close cell details"
        >
          ×
        </button>
      </div>
      {execution?.outcome?.kind === "error" && (
        <div className="error-panel">
          <strong>{execution.outcome.error.name ?? "Execution failed"}</strong>
          <p>{execution.outcome.error.message}</p>
        </div>
      )}
      {execution?.outcome?.kind === "skipped" && (
        <div className="notice">{execution.outcome.message}</div>
      )}
      {pending.map((input) => (
        <div className="notice" key={input.id}>
          Waiting for input: {input.prompt || "Python input"}. Answer in the notebook.
        </div>
      ))}
      <div className="tabs" role="tablist" aria-label="Cell details">
        {["Source", "Logs", "Output", "Variables"].map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="details-content" role="tabpanel">
        {tab === "Source" && (
          <>
            <div className="bindings">
              <div>
                <span>READS</span>
                <p>{analysis?.refs.join(", ") || "—"}</p>
              </div>
              <div>
                <span>DEFINES</span>
                <p>{analysis?.defs.join(", ") || "—"}</p>
              </div>
            </div>
            {analysis?.errors.map((error, index) => (
              <div className="error-panel" key={index}>
                {error.message}
              </div>
            ))}
            <pre className="source">
              {cell.code ?? "Source is not exposed by this host."}
            </pre>
          </>
        )}
        {tab === "Logs" &&
          (logs.length ? (
            <pre>
              {logs.map((log) => (
                <span className={log.name === "stderr" ? "stderr" : ""} key={log.id}>
                  {log.text}
                </span>
              ))}
            </pre>
          ) : (
            <p className="empty-detail">No console output for this execution.</p>
          ))}
        {tab === "Output" && (
          <>
            {execution?.outcome?.kind === "value" && execution.outcome.display && (
              <CellOutput {...execution.outcome.display} />
            )}
            {execution?.outcome?.kind === "error" &&
              execution.outcome.error.traceback && (
                <CellOutput {...execution.outcome.error.traceback} />
              )}
            {displays.map((display) => (
              <CellOutput key={display.id} {...display.content} />
            ))}
            {!displays.length &&
              !(execution?.outcome?.kind === "value" && execution.outcome.display) &&
              !(
                execution?.outcome?.kind === "error" &&
                execution.outcome.error.traceback
              ) && (
                <p className="empty-detail">No rendered output for this execution.</p>
              )}
          </>
        )}
        {tab === "Variables" &&
          (variables.length ? (
            <div className="variables">
              {variables.map((variable) => (
                <div key={variable.id}>
                  <strong>{variable.name}</strong>
                  <span>{variable.type}</span>
                  <pre>{variable.preview ?? "Preview unavailable"}</pre>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-detail">No variables bound by this execution.</p>
          ))}
      </div>
      <div className="details-footer">{cellId} · read only</div>
    </aside>
  );
}
