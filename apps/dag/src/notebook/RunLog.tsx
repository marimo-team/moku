import { useState } from "react";
import type * as Protocol from "@marimo-team/client/protocol";
import { cellLabel, type NotebookState } from "./model.ts";

export function RunLog({
  state,
  run,
}: {
  state: NotebookState;
  run: Protocol.RunOutput | undefined;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const executions = Object.values(state.executions).filter(
    (e) => !run || e.run_id === run.id,
  );
  const running = executions.find((e) => e.status === "running");
  const executionIds = new Set(executions.map((e) => e.id));
  const logs = Object.values(state.consoles).filter((log) =>
    executionIds.has(log.execution_id),
  );
  return (
    <>
      <button
        className="run-log-toggle"
        aria-expanded={logOpen}
        onClick={() => setLogOpen(!logOpen)}
      >
        <span className="chevron">{logOpen ? "⌄" : "›"}</span>
        <strong>Run log</strong>
        {running?.cell_id && state.cells[running.cell_id] && (
          <span>{cellLabel(state.cells[running.cell_id], 0)} · running</span>
        )}
      </button>
      {logOpen && (
        <pre className="run-log">
          {logs.length
            ? logs.map((log) => (
                <span key={log.id} className={log.name}>
                  {log.text}
                </span>
              ))
            : "No console output for this run."}
        </pre>
      )}
    </>
  );
}
