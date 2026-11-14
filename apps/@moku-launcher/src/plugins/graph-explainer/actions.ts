import * as React from "react";
import { RegistryContext, useAtom } from "@effect/atom-react";
import { Cause, Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/Protocol";
import type { NotebookState } from "./execution.ts";

type RunAction = "run" | "cancel";

function unavailableReason(state: NotebookState, kind: RunAction, busy: boolean) {
  if (busy) return "Waiting for the host to acknowledge the previous action";
  const operations = state.notebook?.operations ?? [];
  if (kind === "cancel")
    return operations.includes("runtime.run") || operations.includes("runtime.execute")
      ? ""
      : "The host does not support cancelling runs";
  if (!operations.includes("runtime.run"))
    return "The host does not support runtime.run";
  if (!state.runtime && !operations.includes("runtime.start"))
    return "The host does not support runtime.start";
  if (state.runtime && state.runtime.status !== "running")
    return `Runtime is ${state.runtime.status}`;
  if (!(state.document?.cells ?? []).some((cell) => !cell.config.disabled))
    return "No enabled cells to run";
  return "";
}

export function useRunActions(
  notebook: Notebook.Interface,
  state: NotebookState,
  run: Protocol.RunOutput | undefined,
  connected: boolean,
) {
  const registry = React.useContext(RegistryContext);
  const command = React.useMemo(
    () =>
      Atom.fn((input: { kind: RunAction; runId?: string; cellId?: string }, get) =>
        Effect.gen(function* () {
          if (input.kind === "cancel" && input.runId) {
            yield* notebook.runtime
              .cancel({ runId: input.runId })
              .pipe(Effect.timeout("10 seconds"));
            return;
          }
          yield* notebook.ensureRunning;
          const latest = get(notebook.state);
          if (!AsyncResult.isSuccess(latest) || latest.waiting)
            return yield* Effect.fail(
              new Error("Waiting for the notebook connection."),
            );
          const cells = latest.value.document?.cells ?? [];
          const selected = input.cellId
            ? cells.filter((cell) => cell.id === input.cellId)
            : cells;
          if (selected.length === 0)
            return yield* Effect.fail(
              new Error("The cell was removed before it could run."),
            );
          yield* notebook.runtime
            .run({ cells: selected })
            .pipe(Effect.timeout("10 seconds"));
        }),
      ).pipe(Atom.setIdleTTL(0)),
    [notebook],
  );
  const [result, execute] = useAtom(command);
  const busy = result.waiting;
  const error =
    !busy && AsyncResult.isFailure(result) ? Cause.squash(result.cause) : null;
  const actionError =
    !busy && AsyncResult.isFailure(result)
      ? error instanceof Error && error.name === "TimeoutError"
        ? "The host did not become ready or acknowledge the action in time. Check the runtime before retrying."
        : Cause.pretty(result.cause)
      : "";
  const actionKind: RunAction = run && run.status !== "completed" ? "cancel" : "run";
  const starting = state.runtime?.status === "starting" || (busy && !state.runtime);
  const actionLabel = starting
    ? "Starting kernel"
    : actionKind === "cancel"
      ? "Cancel run"
      : "Run";
  const disabledReason = connected
    ? unavailableReason(state, actionKind, busy)
    : "Waiting for the notebook connection";
  const cellRunDisabled =
    actionKind === "cancel" ? "Wait for the current run to finish" : disabledReason;

  function action(kind: RunAction, cellId?: string) {
    if (registry.get(command).waiting) return;
    execute({ kind, cellId, runId: run?.id });
  }
  return {
    actionKind,
    actionLabel,
    starting,
    disabledReason,
    cellRunDisabled,
    actionError,
    action,
  };
}
