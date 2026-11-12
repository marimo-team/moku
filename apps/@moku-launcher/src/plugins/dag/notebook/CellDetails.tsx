import { useState } from "react";
import type * as Protocol from "@moku/core/Protocol";
import * as Outputs from "@moku/core/Outputs";
import { CellOutputs, ConsoleOutput } from "@moku/outputs";
import { cellLabel, type NotebookState } from "./model.ts";

export function CellDetails({
  state,
  cellId,
  run,
  onClose,
}: {
  state: NotebookState;
  cellId: string;
  run?: Protocol.RunOutput;
  onClose: () => void;
}) {
  const [tab, setTab] = useState("Source");
  const cell = state.cells[cellId];
  if (!cell) return null;
  const execution = Object.values(state.executions)
    .filter(
      (e) =>
        e.cell_id === cellId &&
        (run ? e.run_id === run.id : e.runtime_id === state.runtime?.id),
    )
    .sort(
      (a, b) =>
        (Date.parse(b.started_at ?? b.completed_at ?? "") || 0) -
        (Date.parse(a.started_at ?? a.completed_at ?? "") || 0),
    )[0];
  const outputs: Outputs.Snapshot = execution
    ? Outputs.forExecution(state, execution.id)
    : { runtimeId: null, items: [], outcome: null };
  const logs = outputs.items.filter((item) => item.kind === "console");
  const displays = outputs.items.filter((item) => item.kind === "display");
  const hasOutput =
    displays.length > 0 ||
    (outputs.outcome !== null &&
      (outputs.outcome.kind !== "value" || outputs.outcome.display !== null));
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
      {tab !== "Output" && execution?.outcome?.kind === "error" && (
        <div className="error-panel">
          <strong>{execution.outcome.error.name ?? "Execution failed"}</strong>
          <p>{execution.outcome.error.message}</p>
        </div>
      )}
      {tab !== "Output" && execution?.outcome?.kind === "skipped" && (
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
            <ConsoleOutput chunks={logs} />
          ) : (
            <p className="empty-detail">No console output for this execution.</p>
          ))}
        {tab === "Output" &&
          (hasOutput ? (
            <CellOutputs
              items={displays}
              outcome={outputs.outcome}
              runtimeId={outputs.runtimeId}
            />
          ) : (
            <p className="empty-detail">No rendered output for this execution.</p>
          ))}
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
