import { useState } from "react";
import { Effect } from "effect";
import type * as Notebook from "@momo/model/Notebook";
import type * as Protocol from "@momo/model/Protocol";
import type { NotebookState } from "./model.ts";

type RunAction = "start" | "run" | "cancel";
const ACTION_LABELS = { start: "Start runtime", run: "Run", cancel: "Cancel run" };

function nextAction(
  state: NotebookState,
  run: Protocol.RunOutput | undefined,
): RunAction {
  if (run && run.status !== "completed") return "cancel";
  return state.runtime?.status === "running" ? "run" : "start";
}

function unavailableReason(state: NotebookState, kind: RunAction, busy: boolean) {
  if (busy) return "Waiting for the host to acknowledge the previous action";
  if (!state.ready) return "Waiting for the notebook snapshot";
  // Hosts that support either cells or scratch execution can interrupt runs.
  const operations = state.notebook?.operations ?? [];
  const supported =
    kind === "cancel"
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
  notebook: Notebook.Interface,
  state: NotebookState,
  run: Protocol.RunOutput | undefined,
  connected: boolean,
) {
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const actionKind = nextAction(state, run);
  const actionLabel = ACTION_LABELS[actionKind];
  const disabledReason = connected
    ? unavailableReason(state, actionKind, busy)
    : "Waiting for the notebook connection";
  let cellRunDisabled = disabledReason;
  if (actionKind === "cancel") cellRunDisabled = "Wait for the current run to finish";
  else if (actionKind !== "run") cellRunDisabled = "Start the runtime first";

  async function action(kind: RunAction, cellId?: string) {
    if (!notebook) return;
    setBusy(true);
    setActionError("");
    try {
      const requestId = crypto.randomUUID();
      let request: Effect.Effect<unknown, unknown>;
      if (kind === "start") request = notebook.runtime.start({ requestId });
      else if (kind === "cancel" && run)
        request = notebook.runtime.cancel({ runId: run.id, requestId });
      else {
        const ids = cellId ? [cellId] : (state.document?.order ?? []);
        const cells = ids.flatMap((id) => {
          const cell = state.cells[id];
          return cell && !cell.config.disabled ? [{ id, etag: cell.etag }] : [];
        });
        request = notebook.runtime.run({ request: { cells }, requestId });
      }
      await Effect.runPromise(request.pipe(Effect.timeout("10 seconds")));
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
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
