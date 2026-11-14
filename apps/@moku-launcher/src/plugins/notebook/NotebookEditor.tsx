import * as Observation from "../observation.ts";
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
import { useNotebookShortcuts } from "./useNotebookShortcuts.ts";

export function NotebookEditor({ notebook }: ViewProps) {
  const result = useAtomValue(Model.forNotebook(notebook));
  const appearance = useAtomValue(Theme.appearance);
  React.useEffect(() => {
    Outputs.setTheme(appearance);
  }, [appearance]);
  return (
    <div className="moku-notebook" data-theme={appearance}>
      {AsyncResult.isSuccess(result) ? (
        <DocumentContext value={result.value.document}>
          <NotebookContent notebook={notebook} model={result.value} />
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
}: Pick<ViewProps, "notebook"> & { model: Model.Interface }) {
  const documentModel = useDocument();
  const { document, canEdit, dirty, status: sync } = useAtomValue(documentModel.state);
  const {
    value: state,
    status,
    error,
    ready,
  } = Observation.read(useAtomValue(notebook.state));
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
  const connected = status === "connected" && ready;
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
  return (
    <div className="notebook-screen" data-starting={starting}>
      <KernelStartupNotice
        active={starting}
        cancelling={cancelling}
        message={kernel?.message}
        cancel={canCancel ? () => cancel() : undefined}
      />
      <NotebookToolbar
        connection={{ status, error, ready: ready }}
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
          <div className="cells" aria-busy={starting} inert={starting}>
            {order.map((cellId) => {
              const cell = document?.cells.get(cellId);
              const active = selection.current.get(cellId);
              const cellRunning = active !== undefined && active.status !== "completed";
              return cell ? (
                <Cell
                  key={cellId}
                  cell={cell}
                  onHideCodeChange={
                    canEdit
                      ? (hide_code) =>
                          documentModel.edit((edit) =>
                            edit.updateConfig(cellId, { hide_code }),
                          )
                      : undefined
                  }
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
              ) : null;
            })}
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
