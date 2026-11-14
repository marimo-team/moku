import * as Observation from "../observation.ts";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import * as React from "react";
import { Cause, Effect } from "effect";
import * as Outputs from "@moku/core/Outputs";
import { CellOutputs } from "@moku/outputs";
import type { ViewProps } from "@moku/plugin";
import * as Document from "@moku/editor/Document";
import { CellEditor } from "./CellEditor.tsx";
import { useDraftNavigationGuard } from "../notebook/useDraftNavigationGuard.ts";

import * as Actions from "./actions.ts";

type Action = "start" | "run" | "save" | "sync";

// Keep the draft alive across renders and cell changes; release it when the view closes.
const drafts = Atom.family((notebook: ViewProps["notebook"]) =>
  Atom.make(Document.make(notebook)).pipe(Atom.setIdleTTL(0)),
);

export function Basic({ notebook }: ViewProps) {
  const draft = useAtomValue(drafts(notebook));
  if (!AsyncResult.isSuccess(draft))
    return (
      <p role="status">
        {AsyncResult.isFailure(draft)
          ? "Could not open notebook."
          : "Opening notebook…"}
      </p>
    );
  return <CellPicker notebook={notebook} document={draft.value} />;
}

function CellPicker({
  notebook,
  document,
}: Pick<ViewProps, "notebook"> & { document: Document.Interface }) {
  const draft = useAtomValue(document.state);
  const {
    value: state,
    status,
    error: connectionError,
    ready,
  } = Observation.read(useAtomValue(notebook.state));
  const [selected, setSelected] = React.useState("");
  const [actionKind, setActionKind] = React.useState<Action>("start");
  const command = React.useMemo(
    () =>
      Atom.fn((action: Effect.Effect<unknown, unknown>) => action).pipe(
        Atom.setIdleTTL(0),
      ),
    [notebook, document],
  );
  const [result, execute] = useAtom(command);
  const pending = result.waiting ? actionKind : null;
  const error =
    !result.waiting && AsyncResult.isFailure(result)
      ? Cause.pretty(result.cause)
      : null;

  const order = draft.document?.order ?? [];

  // If another client removes the selection, fall back to the first remaining cell.
  const cellId = order.includes(selected) ? selected : order[0];
  const cell = cellId ? draft.document?.cells.get(cellId) : undefined;

  // Show the selected cell’s active execution, or its latest result in this runtime.
  const executions = Object.values(state.executions).filter(
    (execution) =>
      execution.cell_id === cellId && execution.runtime_id === state.runtime?.id,
  );
  const execution =
    executions.find((entry) => entry.status !== "completed") ??
    executions.sort(
      (a, b) =>
        Date.parse(b.started_at ?? b.completed_at ?? "") -
        Date.parse(a.started_at ?? a.completed_at ?? ""),
    )[0];
  const busy =
    pending === "run" || (execution !== undefined && execution.status !== "completed");

  // The toolbar reflects host permissions and runtime state.
  const available = status === "connected" && ready && pending === null;
  const operations = state.notebook?.operations ?? [];
  const running = state.runtime?.status === "running";
  const starting = pending === "start" || state.runtime?.status === "starting";
  const unsaved =
    draft.dirty ||
    (!!state.document && state.document.etag !== state.document.saved_etag);
  useDraftNavigationGuard(document, unsaved);
  const canRun =
    available &&
    operations.includes("runtime.run") &&
    !!cell &&
    !cell.config.disabled &&
    !busy;
  const canStart =
    available &&
    operations.includes("runtime.start") &&
    !starting &&
    state.runtime?.status !== "terminating";
  const canSave = available && operations.includes("notebook.save") && unsaved;

  // All commands share pending and error feedback.
  function perform(kind: Action, action: Effect.Effect<unknown, unknown>) {
    setActionKind(kind);
    execute(action);
  }

  const start = notebook.runtime.start();
  const save = document.flush.pipe(
    Effect.flatMap((confirmed) =>
      notebook.save({
        ...confirmed,
      }),
    ),
  );

  // Warn before leaving a draft that has not been saved to disk.
  React.useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  return (
    <section className="basic-cell" aria-label="Basic cell editor">
      <style>{styles}</style>
      <div className="basic-toolbar" role="group" aria-label="Cell controls">
        <label>
          Cell{" "}
          <span className="basic-picker">
            <select
              value={cellId ?? ""}
              disabled={!order.length}
              onChange={(event) => setSelected(event.target.value)}
            >
              {!order.length && <option value="">No cells</option>}
              {order.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </span>
        </label>
        <span className="basic-runtime" role="status">
          Runtime {state.runtime?.status ?? "stopped"}
        </span>
        {/* Starting a runtime and executing a cell are separate, explicit actions. */}
        {running ? (
          <button
            disabled={!canRun}
            onClick={() =>
              cellId && perform("run", Actions.runCell(notebook, document, cellId))
            }
          >
            {busy ? "Running…" : "Run cell"}
          </button>
        ) : (
          <button disabled={!canStart} onClick={() => perform("start", start)}>
            {starting ? "Starting runtime…" : "Start runtime"}
          </button>
        )}
        <button disabled={!canSave} onClick={() => perform("save", save)}>
          {pending === "save" ? "Saving…" : unsaved ? "Save •" : "Save"}
        </button>
      </div>
      {cell ? (
        <CellEditor document={document} cellId={cell.id} />
      ) : (
        <p>{ready ? "This notebook has no cells." : "Connecting…"}</p>
      )}
      {execution && (
        <div className="basic-output" role="region" aria-label="Cell output">
          <CellOutputs {...Outputs.forExecution(state, execution.id)} />
        </div>
      )}
      {draft.status.status === "error" && (
        <p role="alert">
          {draft.status.error.message}{" "}
          <button
            disabled={pending !== null}
            onClick={() => perform("sync", document.retry)}
          >
            Retry sync
          </button>
        </p>
      )}
      {(error !== null || connectionError !== null) && (
        <p role="alert">
          {error ??
            (connectionError instanceof Error
              ? connectionError.message
              : "Connection failed.")}
        </p>
      )}
    </section>
  );
}

const styles = `
.basic-cell { max-width: 720px; margin: 64px auto; font-size: 13px; }
.basic-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.basic-toolbar label { display: flex; align-items: center; gap: 8px; }
.basic-toolbar select, .basic-toolbar button { height: 30px; padding: 0 10px; border: 1px solid #e0e0e0; border-radius: 5px; background: white; color: inherit; }
.basic-picker { padding-right: 10px; border: 1px solid #e0e0e0; border-radius: 5px; }
.basic-picker select { border: 0; height: 28px; }
.basic-toolbar button:not(:disabled):hover { background: #f6f6f6; }
.basic-picker select:focus { outline: none; }
.basic-picker:has(select:focus-visible) { outline: 2px solid #9292b3; outline-offset: 2px; }
.basic-runtime { margin-left: auto; color: #888; font-size: 12px; }
.basic-output { padding: 20px 12px; overflow: auto; }
.basic-cell > [role="alert"] { color: #a2544e; }
`;
