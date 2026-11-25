import { useAtom, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { Cause } from "effect";
import * as React from "react";
import * as Outputs from "@moku/outputs";
import type { ViewProps } from "@moku/plugin";
import { empty } from "../empty.ts";
import * as Theme from "../notebook/appearance/theme.ts";
import * as NotebookOutputs from "../notebook/outputs.ts";
import { useDraftNavigationGuard } from "../notebook/useDraftNavigationGuard.ts";
import * as Address from "./address.ts";
import * as Chart from "./chart.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import * as Formula from "./formula.ts";
import { type Editing, Grid } from "./Grid.tsx";
import * as Model from "./model.ts";

/** A spreadsheet over a marimo notebook, where each grid cell is one marimo cell. */
export function Sheet({ notebook }: ViewProps) {
  const model = useAtomValue(Model.forNotebook(notebook));
  if (!AsyncResult.isSuccess(model))
    return (
      <p role="status">
        {AsyncResult.isFailure(model)
          ? "Could not open notebook."
          : "Opening notebook…"}
      </p>
    );
  return <Workbook notebook={notebook} model={model.value} />;
}

function Workbook({ notebook, model }: ViewProps & { model: Model.Interface }) {
  const draft = useAtomValue(model.document.state);
  const connection = useAtomValue(notebook.state);
  const state = AsyncResult.getOrElse(connection, () => empty);
  const ready = AsyncResult.isSuccess(connection) && !connection.waiting;
  const connectionError = AsyncResult.isFailure(connection)
    ? Cause.squash(connection.cause)
    : null;
  const layout = useAtomValue(model.layout);
  const values = useAtomValue(model.values);
  const [evaluation, evaluate] = useAtom(model.evaluate);
  const [saving, save] = useAtom(model.save);

  const [position, setPosition] = React.useState<Address.Position>({ col: 0, row: 0 });
  // A selected chart or other cell that is not on the grid.
  const [other, setOther] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const grid = React.useRef<HTMLDivElement>(null);
  const formula = React.useRef<HTMLDivElement>(null);
  const appearance = useAtomValue(Theme.appearance);
  React.useEffect(() => {
    Outputs.setTheme(appearance);
  }, [appearance]);

  const address = Address.format(position);
  const placed = layout.cells.get(address);
  const offGrid = [...layout.others, ...layout.charts.map((chart) => chart.cell)];
  const cell = other ? offGrid.find((entry) => entry.id === other) : placed;
  const chartSelected = layout.charts.some((chart) => chart.cell.id === other);
  const input = placed ? Formula.toInput(address, placed.code ?? "") : "";
  // Cells with several statements have no formula form and are edited as Python.
  const pythonOnly = placed !== undefined && input === null;
  // The formula bar edits Python for charts, other cells, and such grid cells.
  const python = cell !== undefined && (other !== null || pythonOnly);

  const operations = state.notebook?.operations ?? [];
  const available = ready;
  const canEdit = available && draft.canEdit;
  const canRun = available && operations.includes("runtime.run");
  const unsaved =
    draft.dirty ||
    (!!state.document && state.document.etag !== state.document.saved_etag);
  const canSave =
    available && operations.includes("notebook.save") && unsaved && !saving.waiting;
  useDraftNavigationGuard(model.document, unsaved);

  const failed = (result: AsyncResult.AsyncResult<unknown, unknown>) =>
    !result.waiting && AsyncResult.isFailure(result)
      ? Cause.pretty(result.cause)
      : null;
  const error = failed(evaluation) ?? failed(saving);

  // A spreadsheet shows computed values when it opens. If the current runtime
  // has not evaluated this sheet, recalculate once, starting a runtime if needed.
  const uncalculated = [...values.cells.values()].some(
    (entry) => entry.display.kind === "formula",
  );
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current || !canRun || !draft.document) return;
    opened.current = true;
    const ran = Object.values(state.executions).some(
      (execution) =>
        execution.cell_id !== null && execution.runtime_id === state.runtime?.id,
    );
    if (!ran && layout.placed.size > 0) evaluate({ all: true });
  }, [canRun, draft.document, state, layout, evaluate]);

  function select(next: Address.Position) {
    setOther(null);
    setPosition(next);
  }
  function startEditing(text: string | null, target: Editing["target"]) {
    if (text === null && pythonOnly) {
      formula.current?.querySelector<HTMLElement>(".cm-content")?.focus();
      return;
    }
    if (!canEdit) return;
    setOther(null);
    setEditing({ text: text ?? input ?? "", target });
  }
  function commit(move?: Partial<Address.Position>) {
    if (editing && model.write(address, editing.text) && canRun) evaluate({});
    setEditing(null);
    if (move) setPosition(Address.move(position, move, layout.size));
    grid.current?.focus();
  }
  function cancel() {
    setEditing(null);
    grid.current?.focus();
  }
  function clear() {
    if (chartSelected && other) {
      model.remove(other);
      setOther(null);
      return;
    }
    if (canEdit && model.write(address, "") && canRun) evaluate({});
  }
  function addChart() {
    const draft = Chart.draft(layout, values, position);
    const id = model.addChart(draft.anchor, draft.code);
    if (!id) return;
    setOther(id);
    if (canRun) evaluate({});
  }
  function runCell(cellId: string) {
    model.touch(cellId);
    if (canRun) evaluate({});
  }

  // Grid cells and charts show their output in place, so only errors need a home.
  const value = cell ? values.cells.get(cell.id) : undefined;
  const outcome = cell
    ? NotebookOutputs.forCell(state, values.outputs, cell.id).outcome
    : null;
  const problem =
    value?.display.kind === "error"
      ? value.display.message
      : outcome?.kind === "failed"
        ? [outcome.error.name, outcome.error.message].filter(Boolean).join(": ")
        : null;
  const label = !other ? address : chartSelected ? "Chart" : "Python";
  const exit = () => grid.current?.focus();

  return (
    <section className="moku-sheet" data-theme={appearance} aria-label="Sheet">
      <div className="sheet-toolbar" role="group" aria-label="Sheet controls">
        <button disabled={!canRun} onClick={() => evaluate({ all: true })}>
          {evaluation.waiting ? "Calculating…" : "Recalculate"}
        </button>
        <button
          disabled={!canEdit}
          title="Add a chart of the selected column, drawn with matplotlib"
          onClick={addChart}
        >
          Chart
        </button>
        <button disabled={!canSave} onClick={() => save()}>
          {saving.waiting ? "Saving…" : unsaved ? "Save •" : "Save"}
        </button>
        <span className="sheet-others" role="group" aria-label="Python cells">
          Python
          {layout.others.map((entry) => (
            <button
              key={entry.id}
              aria-pressed={entry.id === other}
              title={entry.code ?? undefined}
              onClick={() => setOther(entry.id === other ? null : entry.id)}
            >
              {entry.name !== "_" ? entry.name : summary(entry.code)}
            </button>
          ))}
          <button
            disabled={!canEdit}
            aria-label="Add a Python cell"
            onClick={() => setOther(model.addCell(""))}
          >
            +
          </button>
        </span>
        <span className="sheet-status" role="status">
          {evaluation.waiting
            ? state.runtime?.state.status === "ready"
              ? "Calculating…"
              : "Starting runtime…"
            : uncalculated
              ? "Some formulas are not calculated. Press Recalculate."
              : `Runtime ${state.runtime?.state.status ?? "stopped"}`}
        </span>
      </div>

      <div className="sheet-formula" ref={formula} data-python={python || undefined}>
        <span className="sheet-address">{label}</span>
        {python && cell ? (
          <>
            <CodeEditor
              key={cell.id}
              document={model.document}
              cellId={cell.id}
              onRun={() => runCell(cell.id)}
              onExit={exit}
            />
            <span className="sheet-formula-actions">
              <button
                disabled={!canRun}
                title="Run (⌘↵)"
                onClick={() => runCell(cell.id)}
              >
                Run
              </button>
              {other && (
                <button
                  disabled={!canEdit}
                  onClick={() => {
                    model.remove(cell.id);
                    setOther(null);
                    exit();
                  }}
                >
                  Delete
                </button>
              )}
            </span>
          </>
        ) : (
          <input
            aria-label="Formula"
            spellCheck={false}
            readOnly={!canEdit}
            placeholder="A number, text, or =Python expression"
            value={editing ? editing.text : (input ?? "")}
            onFocus={() => {
              if (!editing) startEditing(null, "bar");
            }}
            onChange={(event) =>
              setEditing({ text: event.target.value, target: "bar" })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit({ row: 1 });
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
          />
        )}
        {problem && (
          <span className="sheet-formula-error" title={problem}>
            {problem}
          </span>
        )}
      </div>

      <Grid
        layout={layout}
        values={values}
        position={position}
        editing={other ? null : editing}
        canEdit={canEdit}
        container={grid}
        onSelect={(next) => {
          if (editing) commit();
          select(next);
        }}
        onEdit={(text) => startEditing(text, "cell")}
        onChange={(text) => setEditing({ text, target: "cell" })}
        onCommit={commit}
        onCancel={cancel}
        onClear={clear}
        chart={chartSelected ? other : null}
        active={other === null}
        onSelectChart={setOther}
        onMoveChart={model.moveChart}
      />

      {draft.status.status === "error" && (
        <p role="alert">{draft.status.error.message}</p>
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

/** A short label for an unnamed cell: its first line of code. */
function summary(code: string | null): string {
  const first = code?.trim().split("\n")[0] ?? "";
  if (first === "") return "empty";
  return first.length > 24 ? `${first.slice(0, 23)}…` : first;
}
