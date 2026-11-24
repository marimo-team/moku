import * as React from "react";
import type * as Protocol from "@moku/core/Protocol";
import * as Outputs from "@moku/core/Outputs";
import { CellOutputs, ConsoleOutput } from "@moku/outputs";
import { cellLabel, type NotebookState } from "./execution.ts";

export function CellDetails({
  state,
  cellId,
  run,
  onClose,
}: {
  state: NotebookState;
  cellId: string;
  run?: typeof Protocol.Run.Type;
  onClose: () => void;
}) {
  const [tab, setTab] = React.useState("Source");
  const cell = state.document?.cells.find((cell) => cell.id === cellId);
  if (!cell) return null;
  const execution = Object.values(state.executions).find(
    (e) =>
      e.cell_id === cellId &&
      (run ? e.run_id === run.id : e.runtime_id === state.runtime?.id),
  );
  const outputs: Outputs.Snapshot = execution
    ? Outputs.forExecution(state, execution.id)
    : { runtimeId: null, items: [], output: null, outcome: null };
  const logs = outputs.items.filter((item) => item.content.kind === "text");
  const rendered = {
    ...outputs,
    items: outputs.items.filter((item) => item.content.kind === "media"),
  };
  const variables = Object.values(state.variables).filter(
    (v) => v.execution_id === execution?.id,
  );
  const analysis = state.analysis?.cells[cellId];
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
      {tab !== "Output" && outputs.outcome?.kind === "failed" && (
        <div className="error-panel">
          <strong>{outputs.outcome.error.name ?? "Execution failed"}</strong>
          <p>{outputs.outcome.error.message}</p>
        </div>
      )}
      {tab !== "Output" && outputs.outcome?.kind === "skipped" && (
        <div className="notice">{outputs.outcome.message}</div>
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
            {analysis?.diagnostics.map((diagnostic, index) => (
              <div
                className={diagnostic.severity === "error" ? "error-panel" : "notice"}
                key={index}
              >
                <strong>{diagnostic.severity}</strong> {diagnostic.message}
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
          (Outputs.hasContent(rendered) ? (
            <CellOutputs {...rendered} />
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
