import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import { useEffect, useState } from "react";
import { Effect } from "effect";
import * as Outputs from "@moku/core/Outputs";
import { CellOutputs, Provider } from "@moku/outputs";
import { Plugin, type ViewProps } from "@moku/plugin";
import * as Document from "@moku/editor/Document";
import { CellEditor } from "./CellEditor.tsx";

type Action = "start" | "run" | "save" | "sync";

// Keep the draft alive across renders and cell changes; release it when the view closes.
const drafts = Atom.family((notebook: ViewProps["notebook"]) =>
  Atom.make(Document.make(notebook)).pipe(Atom.setIdleTTL(0)),
);

export default Plugin.define({
  id: "basic",
  effect: (ctx) => ctx.view.add({ id: "cell", title: "Basic", render: Basic }),
});

function Basic({ notebook }: ViewProps) {
  const draft = useAtomValue(drafts(notebook));
  if (!AsyncResult.isSuccess(draft))
    return (
      <p role="status">
        {AsyncResult.isFailure(draft)
          ? "Could not open notebook."
          : "Opening notebook…"}
      </p>
    );
  return (
    <Provider notebook={notebook}>
      <CellPicker notebook={notebook} document={draft.value} />
    </Provider>
  );
}

function CellPicker({
  notebook,
  document,
}: ViewProps & { document: Document.Interface }) {
  const draft = useAtomValue(document.state);
  const { value: state, status, error: connectionError } = useAtomValue(notebook.state);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Action | null>(null);

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
  const available = status === "connected" && state.ready && pending === null;
  const operations = state.notebook?.operations ?? [];
  const running = state.runtime?.status === "running";
  const starting = pending === "start" || state.runtime?.status === "starting";
  const unsaved =
    draft.dirty ||
    (!!state.document && state.document.etag !== state.document.saved_etag);
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
  async function perform(kind: Action, action: Effect.Effect<unknown, unknown>) {
    setError(null);
    setPending(kind);
    try {
      await Effect.runPromise(action);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  const start = notebook.runtime.start({ requestId: crypto.randomUUID() });
  const save = document.flush.pipe(
    Effect.flatMap((confirmed) =>
      notebook.save({
        requestId: crypto.randomUUID(),
        etag: confirmed.revision.etag,
      }),
    ),
  );

  // Warn before leaving a draft that has not been saved to disk.
  useEffect(() => {
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
              cellId && perform("run", runCell(notebook, document, cellId))
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
        <p>{state.ready ? "This notebook has no cells." : "Connecting…"}</p>
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
      {(error || connectionError) && (
        <p role="alert">{error ?? connectionError?.message}</p>
      )}
    </section>
  );
}

/** Flush edits first so execution uses the source currently shown in the editor. */
export function runCell(
  notebook: ViewProps["notebook"],
  document: Document.Interface,
  cellId: string,
) {
  return Effect.gen(function* () {
    const confirmed = yield* document.flush;
    const cell = confirmed.cells.get(cellId);
    if (!cell || cell.config.disabled)
      return yield* Effect.fail(
        new Error("The selected cell was removed or disabled."),
      );
    return yield* notebook.runtime.run({
      requestId: crypto.randomUUID(),
      request: { cells: [{ id: cell.id, etag: cell.etag }] },
    });
  });
}

// Small, local styles keep the example independent of the notebook editor.
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
