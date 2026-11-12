import { useAtom, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";
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
import { useNotebookShortcuts } from "./useNotebookShortcuts.ts";

export function NotebookEditor({ notebook }: ViewProps) {
  const result = useAtomValue(Model.forNotebook(notebook));
  const appearance = useAtomValue(Theme.appearance);
  useEffect(() => {
    Outputs.setTheme(appearance);
  }, [appearance]);
  return (
    <div className="moku-notebook" data-theme={appearance}>
      {AsyncResult.isSuccess(result) ? (
        <DocumentContext value={result.value.document}>
          <Outputs.Provider notebook={notebook}>
            <NotebookContent notebook={notebook} model={result.value} />
          </Outputs.Provider>
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

function NotebookContent({ notebook, model }: ViewProps & { model: Model.Interface }) {
  const documentModel = useDocument();
  const { document, canEdit, dirty, status: sync } = useAtomValue(documentModel.state);
  const { value: state, status, error } = useAtomValue(notebook.state);
  const selection = useAtomValue(model.outputs);
  const [saving, save] = useAtom(model.save, { mode: "promise" });
  const [execution, run] = useAtom(model.run, { mode: "promise" });
  const [interruption, interrupt] = useAtom(model.interrupt, { mode: "promise" });
  const [cancellation, cancel] = useAtom(model.cancel, { mode: "promise" });
  const navigation = useCellNavigation();
  useNotebookNotifications({
    target: notebook.target,
    sync,
    retry: documentModel.retry,
    saving,
    execution,
    interruption,
    cancellation,
  });
  const connected = status === "connected" && state.ready;
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
  useDraftNavigationGuard(unsaved);
  useNotebookShortcuts({ canSave, saveDisabled, save });
  const currentness = Currentness.forNotebook({
    cells: new Map(Object.entries(state.cells)),
    variables: new Map(Object.entries(state.variables)),
    executions: new Map(Object.entries(state.executions)),
    results: selection.results,
  });
  const insert = (anchor?: string, position: "before" | "after" = "after") => {
    const id = crypto.randomUUID();
    documentModel.edit((edit) =>
      edit.createCell({ id, code: "" }, anchor ? { [position]: anchor } : undefined),
    );
    navigation.focus(id);
  };
  return (
    <div className="notebook-screen" data-starting={starting}>
      <KernelStartupNotice
        active={starting}
        cancelling={cancelling}
        message={kernel?.message}
        cancel={
          canCancel
            ? () => {
                void cancel().catch(() => {});
              }
            : undefined
        }
      />
      <NotebookToolbar
        name={state.notebook?.name ?? "Connecting…"}
        path={state.notebook?.path ?? notebook.target.notebookId}
        connection={{ status, error, ready: state.ready }}
        save={
          canSave
            ? {
                pending: saving.waiting,
                disabled: saveDisabled,
                onClick: () => {
                  void save().catch(() => {});
                },
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
                  void (running ? interrupt() : run({})).catch(() => {});
                },
              }
            : undefined
        }
      />
      <div className="notebook-content">
        {order.length > 0 ? (
          <div className="cells" aria-busy={starting} inert={starting}>
            {order.map((cellId) => {
              const cell = document?.cells.get(cellId);
              const active = selection.current.get(cellId);
              const cellRunning = active !== undefined && active.status !== "completed";
              return cell ? (
                <Cell
                  key={cellId}
                  cell={cell}
                  preferenceKey={`moku:source:${notebook.target.connectionId}:${notebook.target.notebookId}:${cellId}`}
                  focusRequest={
                    navigation.request?.id === cellId
                      ? navigation.request.sequence
                      : undefined
                  }
                  remove={
                    canEdit
                      ? {
                          pending: false,
                          run: () =>
                            documentModel.edit((edit) => edit.deleteCell(cellId)),
                        }
                      : undefined
                  }
                  insert={
                    canEdit
                      ? {
                          pending: false,
                          last: cellId === order.at(-1),
                          at: (position) => insert(cellId, position),
                        }
                      : undefined
                  }
                  hasResult={selection.results.has(cellId)}
                  currentness={state.ready ? currentness(cellId) : null}
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
              ) : null;
            })}
          </div>
        ) : (
          <section className="empty-state">
            <h2>
              {!state.ready
                ? "Connecting…"
                : state.notebook
                  ? "No cells yet."
                  : "Notebook unavailable."}
            </h2>
            {canEdit && <button onClick={() => insert()}>Add cell</button>}
          </section>
        )}
      </div>
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
