import { useContext, useEffect, useRef, useState } from "react";
import { RegistryContext } from "@effect/atom-react";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/Protocol";
import { ensureRuntime } from "../../app/execution.ts";
import type { NotebookState } from "./execution.ts";

type RunAction = "run" | "cancel";

function unavailableReason(state: NotebookState, kind: RunAction, busy: boolean) {
  if (busy) return "Waiting for the host to acknowledge the previous action";
  if (!state.ready) return "Waiting for the notebook snapshot";
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
  if (!Object.values(state.cells).some((cell) => !cell.config.disabled))
    return "No enabled cells to run";
  return "";
}

export function useRunActions(
  notebook: Notebook.Interface,
  state: NotebookState,
  run: Protocol.RunOutput | undefined,
  connected: boolean,
) {
  const registry = useContext(RegistryContext);
  const pending = useRef<AbortController | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => () => pending.current?.abort(), [notebook]);
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

  async function action(kind: RunAction, cellId?: string) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setActionError("");
    const request = Effect.gen(function* () {
      if (kind === "cancel" && run) {
        yield* notebook.runtime
          .cancel({ runId: run.id, requestId: crypto.randomUUID() })
          .pipe(Effect.timeout("10 seconds"));
        return;
      }
      if (!(yield* ensureRuntime(notebook))) return;
      const latest = registry.get(notebook.state);
      if (latest.status !== "connected" || !latest.value.ready)
        return yield* Effect.fail(new Error("Waiting for the notebook connection."));
      const ids = cellId ? [cellId] : (latest.value.document?.order ?? []);
      const cells = ids.flatMap((id) => {
        const cell = latest.value.cells[id];
        return cell && !cell.config.disabled ? [{ id, etag: cell.etag }] : [];
      });
      yield* notebook.runtime
        .run({ request: { cells }, requestId: crypto.randomUUID() })
        .pipe(Effect.timeout("10 seconds"));
    }).pipe(Effect.provideService(AtomRegistry.AtomRegistry, registry));
    try {
      await Effect.runPromise(request, { signal: controller.signal });
    } catch (error) {
      if (!controller.signal.aborted)
        setActionError(
          error instanceof Error && error.name === "TimeoutError"
            ? "The host did not become ready or acknowledge the action in time. Check the runtime before retrying."
            : String(error),
        );
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
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
