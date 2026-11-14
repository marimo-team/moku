import * as React from "react";
import { ConsoleOutput } from "@moku/outputs";
import type * as Protocol from "@moku/core/Protocol";
import { cellLabel, type NotebookState } from "./execution.ts";

export function RunLog({
  state,
  run,
}: {
  state: NotebookState;
  run: Protocol.RunOutput | undefined;
}) {
  const [logOpen, setLogOpen] = React.useState(false);
  const executions = Object.values(state.executions).filter(
    (e) => !run || e.run_id === run.id,
  );
  const running = executions.find((e) => e.status === "running");
  const runningCell = state.document?.cells.find(
    (cell) => cell.id === running?.cell_id,
  );
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
        {runningCell && <span>{cellLabel(runningCell, 0)} · running</span>}
      </button>
      {logOpen &&
        (logs.length ? (
          <ConsoleOutput className="run-log" chunks={logs} />
        ) : (
          <p className="run-log">No console output for this run.</p>
        ))}
    </>
  );
}
