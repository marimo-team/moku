import { useState } from "react";
import type { NotebookClient } from "@marimo-team/client";
import type * as Protocol from "@marimo-team/client/protocol";
import type { NotebookState } from "./model.ts";

type RunAction = "start" | "run" | "interrupt";
const ACTION_LABELS = { start: "Start runtime", run: "Run", interrupt: "Interrupt" };

function nextAction(
  state: NotebookState,
  run: Protocol.RunOutput | undefined,
): RunAction {
  if (run && run.status !== "completed") return "interrupt";
  return state.runtime?.status === "running" ? "run" : "start";
}

function unavailableReason(state: NotebookState, kind: RunAction, busy: boolean) {
  if (busy) return "Waiting for the host to acknowledge the previous action";
  if (!state.ready) return "Waiting for the notebook snapshot";
  // Hosts that support either cells or scratch execution can interrupt runs.
  const operations = state.notebook?.operations ?? [];
  const supported =
    kind === "interrupt"
      ? operations.includes("runtime.run") || operations.includes("runtime.execute")
      : operations.includes(`runtime.${kind}`);
  if (!supported) return `The host does not support runtime.${kind}`;
  if (kind === "start" && state.runtime) return `Runtime is ${state.runtime.status}`;
  if (
    kind === "run" &&
    !Object.values(state.cells).some((cell) => !cell.config.disabled)
  )
    return "No enabled cells to run";
  return "";
}

export function useRunActions(
  notebook: NotebookClient | null,
  state: NotebookState,
  run: Protocol.RunOutput | undefined,
) {
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const actionKind = nextAction(state, run);
  const actionLabel = ACTION_LABELS[actionKind];
  const disabledReason = unavailableReason(state, actionKind, busy);
  let cellRunDisabled = disabledReason;
  if (actionKind === "interrupt")
    cellRunDisabled = "Wait for the current run to finish";
  else if (actionKind !== "run") cellRunDisabled = "Start the runtime first";

  async function action(kind: RunAction, cellId?: string) {
    if (!notebook) return;
    setBusy(true);
    setActionError("");
    try {
      const options = { signal: AbortSignal.timeout(10000) };
      let result;
      if (kind === "start") result = await notebook.start(options);
      else if (kind === "interrupt" && run)
        result = await notebook.interrupt(run.id, options);
      else {
        const ids = cellId ? [cellId] : (state.document?.order ?? []);
        const cells = ids.flatMap((id) => {
          const cell = state.cells[id];
          return cell && !cell.config.disabled ? [{ id, etag: cell.etag }] : [];
        });
        result = await notebook.run({ cells, ...options });
      }
      if (!result.ok) setActionError(result.problem.detail ?? result.problem.title);
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      setActionError(
        timedOut
          ? "The host did not acknowledge the action within 10 seconds. Check the run status before retrying."
          : String(error),
      );
    } finally {
      setBusy(false);
    }
  }
  return {
    actionKind,
    actionLabel,
    disabledReason,
    cellRunDisabled,
    actionError,
    action,
  };
}
