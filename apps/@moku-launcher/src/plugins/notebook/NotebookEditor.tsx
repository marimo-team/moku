import { empty } from "../empty.ts";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as React from "react";
import type { ViewProps } from "@moku/plugin";
import * as Outputs from "@moku/outputs";
import * as Model from "./model.ts";
import * as CellOutputs from "./outputs.ts";
import * as Currentness from "./currentness.ts";
import * as Theme from "./appearance/theme.ts";
import { DocumentContext, useDocument } from "./DocumentContext.ts";
import { useDraftNavigationGuard } from "./useDraftNavigationGuard.ts";
import { useCellNavigation } from "./cells/useCellNavigation.ts";
import { Cell } from "./cells/Cell.tsx";
import { KernelStartupNotice } from "./KernelStartupNotice.tsx";
import { NotebookToolbar } from "./NotebookToolbar.tsx";
import { NotificationList } from "./feedback/NotificationList.tsx";
import { useNotebookNotifications } from "./feedback/useNotebookNotifications.ts";
import { useNotebookShortcuts, useSelectionShortcuts } from "./useNotebookShortcuts.ts";
import { useCellSelection } from "./cells/useCellSelection.ts";
import * as Reorder from "./cells/reorder.ts";
import type * as Document from "@moku/editor/Document";

/** Content that another view adds around the notebook's cells. */
export interface Extensions {
  /** Renders below a cell, for example controls that belong to that cell. */
  readonly afterCell?: (input: {
    readonly cell: Document.EditableCell;
    readonly model: Model.Interface;
  }) => React.ReactNode;
  /** Renders after the last cell, including when the notebook has none. */
  readonly footer?: (input: { readonly model: Model.Interface }) => React.ReactNode;
  /** Renders below the scrolling cells, so it stays in view. */
  readonly bottom?: (input: { readonly model: Model.Interface }) => React.ReactNode;
  /**
   * Whether cells can be inserted between existing ones. Defaults to true.
   *
   * Views that only append, such as a conversation, turn this off and add cells
   * through their own controls.
   */
  readonly insertBetween?: boolean;
  /** Labels a cell so the view can style it, exposed as `data-kind` on the cell. */
  readonly cellKind?: (cell: Document.EditableCell) => string | undefined;
  /** Renders in place of a cell's source until it has a result, or returns undefined to show the source. */
  readonly preview?: (cell: Document.EditableCell) => React.ReactNode | undefined;
}

export function NotebookEditor({
  notebook,
  extensions,
}: ViewProps & { extensions?: Extensions }) {
  const result = useAtomValue(Model.forNotebook(notebook));
  const appearance = useAtomValue(Theme.appearance);
  React.useEffect(() => {
    Outputs.setTheme(appearance);
  }, [appearance]);
  return (
    <div className="moku-notebook" data-theme={appearance}>
      {AsyncResult.isSuccess(result) ? (
        <DocumentContext value={result.value.document}>
          <NotebookContent
            notebook={notebook}
            model={result.value}
            extensions={extensions}
          />
        </DocumentContext>
      ) : (
        <p className="notice">
          {AsyncResult.isFailure(result)
            ? "Could not open the notebook."
            : "Opening notebook…"}
        </p>
      )}
      <NotificationList />
    </div>
  );
}

function NotebookContent({
  notebook,
  model,
  extensions,
}: Pick<ViewProps, "notebook"> & { model: Model.Interface; extensions?: Extensions }) {
  const documentModel = useDocument();
  const { document, canEdit, dirty, status: sync } = useAtomValue(documentModel.state);
  const result = useAtomValue(notebook.state);
  const state = AsyncResult.getOrElse(result, () => empty);
  const ready = AsyncResult.isSuccess(result) && !result.waiting;

  const selection = useAtomValue(model.outputs);
  const [saving, save] = useAtom(model.save);
  const [execution, run] = useAtom(model.run, { mode: "promise" });
  const [interruption, interrupt] = useAtom(model.interrupt);
  const [cancellation, cancel] = useAtom(model.cancel);
  const navigation = useCellNavigation();
  useNotebookNotifications({
    sync,
    retry: documentModel.retry,
    saving,
    execution,
    interruption,
    cancellation,
  });
  const connected = ready;
  const kernel = state.runtime;
  const cancelling = cancellation.waiting || kernel?.status === "terminating";
  const starting =
    connected &&
    (cancelling ||
      kernel?.status === "starting" ||
      (execution.waiting && kernel?.status !== "running"));
  const running = [...selection.current.values()].some(
    (entry) => entry.status !== "completed",
  );
  const operations = state.notebook?.operations ?? [];
  const canRun =
    operations.includes("runtime.run") &&
    (kernel?.status === "running" || operations.includes("runtime.start"));
  const canInterrupt = operations.includes("runtime.interrupt");
  const canSave = operations.includes("notebook.save");
  const canCancel =
    operations.includes("runtime.stop") && kernel?.status === "starting";
  const unsaved =
    dirty || (!!state.document && state.document.etag !== state.document.saved_etag);
  const order = document?.order ?? [];
  const saveDisabled = saving.waiting || !connected;
  useDraftNavigationGuard(documentModel, unsaved);
  useNotebookShortcuts({ canSave, saveDisabled, save });
  const picked = useCellSelection(order);
  const cellsRef = React.useRef<HTMLDivElement>(null);
  // Focus lands on a cell's margin, where the keyboard shortcuts for cells apply.
  const focusMargin = (id: string | undefined) =>
    requestAnimationFrame(() => {
      if (id === undefined) return;
      cellsRef.current
        ?.querySelector<HTMLElement>(
          `.cell[data-cell-id="${CSS.escape(id)}"] > .cell-margin`,
        )
        ?.focus();
    });
  const remove = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    const next = Reorder.focusAfterDelete(order, new Set(ids));
    documentModel.edit((edit) => {
      for (const id of ids) edit.deleteCell(id);
    });
    picked.clear();
    focusMargin(next);
  };
  const removeSelected = () => remove(picked.ids);
  // Moving acts on the selection when the cell belongs to it, and otherwise on the cell alone.
  const moveCells = (cellId: string, direction: "up" | "down") => {
    const ids = new Set(picked.has(cellId) ? picked.ids : [cellId]);
    const next = Reorder.move(order, ids, direction);
    if (next === order) return;
    documentModel.edit((edit) => edit.setOrder(next));
    focusMargin(cellId);
  };
  const navigate = (cellId: string, direction: "up" | "down", extend: boolean) => {
    const target = order[order.indexOf(cellId) + (direction === "up" ? -1 : 1)];
    if (target === undefined) return;
    if (extend) picked.extend(cellId, target);
    focusMargin(target);
  };
  const insertBetween = extensions?.insertBetween ?? true;
  useSelectionShortcuts({
    active: picked.ids.length > 0,
    remove: canEdit ? removeSelected : undefined,
    clear: picked.clear,
  });
  const currentness = Currentness.forNotebook({
    cells: new Map(state.document?.cells.map((cell) => [cell.id, cell]) ?? []),
    variables: new Map(Object.entries(state.variables)),
    executions: new Map(Object.entries(state.executions)),
    results: selection.results,
  });
  const insert = (anchor?: string, position: "before" | "after" = "after") => {
    documentModel.edit((edit) => {
      const id = edit.createCell(
        { code: "" },
        anchor ? { [position]: anchor } : undefined,
      );
      navigation.focus(id);
    });
  };
  const renderCell = (cellId: string) => {
    const cell = document?.cells.get(cellId);
    const active = selection.current.get(cellId);
    const cellRunning = active !== undefined && active.status !== "completed";
    return cell ? (
      <React.Fragment key={cellId}>
        <Cell
          cell={cell}
          onHideCodeChange={
            canEdit
              ? (hide_code) =>
                  documentModel.edit((edit) => edit.updateConfig(cellId, { hide_code }))
              : undefined
          }
          focusRequest={
            navigation.request?.id === cellId ? navigation.request.sequence : undefined
          }
          remove={
            canEdit
              ? {
                  pending: false,
                  run: () => documentModel.edit((edit) => edit.deleteCell(cellId)),
                }
              : undefined
          }
          insert={
            canEdit && insertBetween
              ? {
                  pending: false,
                  last: cellId === order.at(-1),
                  at: (position) => insert(cellId, position),
                }
              : undefined
          }
          selection={
            canEdit
              ? {
                  selected: picked.has(cellId),
                  active: picked.ids.length > 0,
                  select: (mode) => picked.select(cellId, mode),
                }
              : undefined
          }
          keyboard={{
            navigate: (direction, extend) =>
              navigate(cellId, direction, extend && canEdit),
            selectAll: picked.selectAll,
            remove: canEdit
              ? () => remove(picked.ids.length > 0 ? picked.ids : [cellId])
              : undefined,
          }}
          move={
            canEdit
              ? {
                  up: cellId === order[0] ? undefined : () => moveCells(cellId, "up"),
                  down:
                    cellId === order.at(-1)
                      ? undefined
                      : () => moveCells(cellId, "down"),
                }
              : undefined
          }
          kind={extensions?.cellKind?.(cell)}
          preview={extensions?.preview?.(cell)}
          hasResult={selection.results.has(cellId)}
          currentness={ready ? currentness(cellId) : null}
          execution={
            canRun
              ? {
                  running: cellRunning,
                  disabled:
                    cellRunning ||
                    execution.waiting ||
                    !connected ||
                    cell.config.disabled,
                  run: (advance = false) => {
                    void run({ cellIds: [cellId] })
                      .then(() => {
                        if (advance) navigation.advance(cellId);
                      })
                      .catch(() => {});
                  },
                }
              : undefined
          }
          outputs={CellOutputs.forCell(state, selection, cellId)}
        />
        {extensions?.afterCell?.({ cell, model })}
      </React.Fragment>
    ) : null;
  };
  const footer = extensions?.footer?.({ model });
  const bottom = extensions?.bottom?.({ model });
  return (
    <div className="notebook-screen" data-starting={starting}>
      <KernelStartupNotice
        active={starting}
        cancelling={cancelling}
        message={kernel?.message}
        cancel={canCancel ? () => cancel() : undefined}
      />
      <NotebookToolbar
        connection={result}
        save={
          canSave
            ? {
                pending: saving.waiting,
                disabled: saveDisabled,
                onClick: () => save(),
              }
            : undefined
        }
        execution={
          (running ? canInterrupt : canRun)
            ? {
                starting,
                running,
                disabled:
                  starting ||
                  execution.waiting ||
                  interruption.waiting ||
                  !connected ||
                  order.length === 0,
                onClick: () => {
                  if (running) interrupt();
                  else void run({}).catch(() => {});
                },
              }
            : undefined
        }
      />
      <div className="notebook-content">
        {order.length > 0 ? (
          <div className="cells" ref={cellsRef} aria-busy={starting} inert={starting}>
            {order.map(renderCell)}
            {footer}
          </div>
        ) : (
          <section className="empty-state">
            <h2>
              {!ready
                ? "Connecting…"
                : state.notebook
                  ? "No cells yet."
                  : "Notebook unavailable."}
            </h2>
            {canEdit && insertBetween && (
              <button onClick={() => insert()}>Add cell</button>
            )}
          </section>
        )}
        {order.length === 0 && footer && <div className="cells">{footer}</div>}
      </div>
      {picked.ids.length > 0 && (
        <div className="cell-selection-bar" role="toolbar" aria-label="Selected cells">
          <span>
            {picked.ids.length} {picked.ids.length === 1 ? "cell" : "cells"} selected ·
            ⌫ deletes, ⌥↑/↓ moves, Esc clears
          </span>
          <button className="cell-selection-delete" onClick={removeSelected}>
            Delete
          </button>
          <button onClick={picked.clear}>Clear</button>
        </div>
      )}
      {bottom}
      <div className="notebook-meta">
        {canSave && unsaved && (
          <span title="Save writes the confirmed notebook to disk">
            {sync.status === "error"
              ? "Edits not synced"
              : dirty
                ? "Syncing edits…"
                : "Unsaved changes"}
          </span>
        )}
        <span>
          {order.length} {order.length === 1 ? "cell" : "cells"}
        </span>
        <span className="notebook-runtime-status" title={kernel?.message ?? undefined}>
          {starting
            ? cancelling
              ? "Cancelling startup…"
              : "Starting kernel…"
            : kernel?.message || (kernel ? `Runtime ${kernel.status}` : "No runtime")}
        </span>
      </div>
    </div>
  );
}
