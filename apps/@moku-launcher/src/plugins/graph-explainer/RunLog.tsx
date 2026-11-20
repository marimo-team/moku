import * as React from "react";
import { ConsoleOutput } from "@moku/outputs";
import type * as Protocol from "@moku/core/Protocol";
import { cellLabel, type NotebookState } from "./execution.ts";

export function RunLog({
  state,
  run,
}: {
  state: NotebookState;
  run: typeof Protocol.Run.Type | undefined;
}) {
  const [logOpen, setLogOpen] = React.useState(false);
  const executions = Object.values(state.executions).filter(
    (e) => !run || e.run_id === run.id,
  );
  const running = executions.find((e) => e.state.status === "running");
  const runningCell = state.document?.cells.find(
    (cell) => cell.id === running?.cell_id,
  );
  const logs = [];
  if (logOpen) {
    const byExecution = Map.groupBy(
      Object.values(state.consoles),
      (item) => item.execution_id,
    );
    for (const execution of executions) {
      const chunks = byExecution.get(execution.id);
      if (chunks)
        logs.push(
          <ConsoleOutput
            key={execution.id}
            chunks={chunks}
            runtimeId={execution.runtime_id}
          />,
        );
    }
  }
  return (
    <>
      <button
        className="run-log-toggle"
        aria-expanded={logOpen}
        onClick={() => setLogOpen(!logOpen)}
      >
        <span className="chevron">{logOpen ? "⌄" : "›"}</span>
        <strong>Run log</strong>
        {runningCell && <span>{cellLabel(runningCell, 0)} · running</span>}
      </button>
      {logOpen &&
        (logs.length ? (
          <div className="run-log">{logs}</div>
        ) : (
          <p className="run-log">No console output for this run.</p>
        ))}
    </>
  );
}
