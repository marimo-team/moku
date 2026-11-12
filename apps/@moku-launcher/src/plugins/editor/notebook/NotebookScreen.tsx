import { useAtom, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useEffect } from "react";
import type { ViewProps } from "@moku/plugin";
import * as Outputs from "@moku/outputs";
import * as Session from "./session.ts";
import * as Cells from "./outputs.ts";
import * as Currentness from "./currentness.ts";
import * as Theme from "../app/theme.ts";
import * as Problems from "../lib/problems.ts";
import { DocumentContext, useDocument, useDraftNavigationGuard } from "./document.tsx";
import { useCellNavigation } from "./useCellNavigation.ts";
import { Cell } from "./Cell.tsx";
import { KernelStartup } from "./KernelStartup.tsx";
import { ThemeControl } from "../components/ThemeControl.tsx";
import { ConnectionStatus } from "../components/ConnectionStatus.tsx";
import { NotificationViewport } from "../components/NotificationViewport.tsx";
import { useFailureNotification, useNotification } from "../app/useNotifications.ts";

export function NotebookScreen({ notebook }: ViewProps) {
  const result = useAtomValue(Session.session(notebook));
  const appearance = useAtomValue(Theme.appearance);
  useEffect(() => {
    Outputs.setTheme(appearance);
  }, [appearance]);
  return (
    <div className="moku-notebook" data-theme={appearance}>
      {AsyncResult.isSuccess(result) ? (
        <DocumentContext value={result.value.document}>
          <Outputs.Provider notebook={notebook}>
            <NotebookView notebook={notebook} session={result.value} />
          </Outputs.Provider>
        </DocumentContext>
      ) : (
        <p className="notice">
          {AsyncResult.isFailure(result)
            ? "Could not open the editor."
            : "Opening editor…"}
        </p>
      )}
      <NotificationViewport />
    </div>
  );
}

function NotebookView({ notebook, session }: ViewProps & { session: Session.Session }) {
  const model = useDocument();
  const { document, canEdit, dirty, status: sync } = useAtomValue(model.state);
  const { value: state, status, error } = useAtomValue(notebook.state);
  const selection = useAtomValue(session.outputs);
  const [saving, save] = useAtom(session.save, { mode: "promise" });
  const [execution, run] = useAtom(session.run, { mode: "promise" });
  const [interruption, interrupt] = useAtom(session.interrupt, { mode: "promise" });
  const [cancellation, cancel] = useAtom(session.cancel, { mode: "promise" });
  const navigation = useCellNavigation();
  const scope = `editor:${notebook.target.connectionId}:${notebook.target.notebookId}`;
  useFailureNotification(saving, {
    id: `${scope}:save`,
    title: "Could not save notebook",
    suppressed: sync.status === "error",
  });
  useFailureNotification(execution, {
    id: `${scope}:run`,
    title: "Could not run notebook",
    suppressed: sync.status === "error",
  });
  useFailureNotification(interruption, {
    id: `${scope}:interrupt`,
    title: "Could not interrupt execution",
  });
  useFailureNotification(cancellation, {
    id: `${scope}:cancel`,
    title: "Could not cancel startup",
  });
  const problem = sync.status === "error" ? Problems.describe(sync.error) : null;
  useNotification(
    problem
      ? {
          id: `${scope}:edits`,
          kind: "error",
          title: problem.title,
          description: problem.description,
          details: problem.details,
          action: problem.retryable
            ? { label: "Retry edits", run: model.retry }
            : undefined,
        }
      : null,
    `${scope}:edits`,
  );
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
  useEffect(() => {
    if (!canSave) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        if (!saveDisabled) void save().catch(() => {});
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canSave, saveDisabled, save]);
  const currentness = Currentness.forNotebook({
    cells: new Map(Object.entries(state.cells)),
    variables: new Map(Object.entries(state.variables)),
    executions: new Map(Object.entries(state.executions)),
    results: selection.results,
  });
  const insert = (anchor?: string, position: "before" | "after" = "after") => {
    const id = crypto.randomUUID();
    model.edit((edit) =>
      edit.createCell({ id, code: "" }, anchor ? { [position]: anchor } : undefined),
    );
    navigation.focus(id);
  };
  return (
    <div className="notebook-screen" data-starting={starting}>
      <KernelStartup
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
      <header className="notebook-heading">
        <a href="/" className="back-link" aria-label="Back to notebooks">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m10 3-5 5 5 5" />
          </svg>
        </a>
        <div className="notebook-title-row">
          <h1 title={state.notebook?.path ?? notebook.target.notebookId}>
            {state.notebook?.name ?? "Connecting…"}
          </h1>
          <ConnectionStatus
            status={status}
            ready={state.ready}
            compact
            error={error ?? undefined}
          />
        </div>
        <div className="notebook-controls">
          <ThemeControl />
          {canSave && (
            <button
              className="notebook-run"
              aria-label="Save notebook"
              title={saving.waiting ? "Saving…" : "Save notebook (⌘/Ctrl+S)"}
              aria-keyshortcuts="Control+S Meta+S"
              disabled={saveDisabled}
              onClick={() => {
                void save().catch(() => {});
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 2h8l3 3v9H2V2h1ZM5 2v4h6V2M5 14V9h6v5" />
              </svg>
            </button>
          )}
          {(running ? canInterrupt : canRun) && (
            <button
              className="notebook-run"
              aria-label={
                starting
                  ? "Starting kernel"
                  : running
                    ? "Interrupt notebook"
                    : "Run notebook"
              }
              title={
                starting
                  ? "Starting kernel…"
                  : running
                    ? "Interrupt notebook"
                    : "Run notebook"
              }
              disabled={
                starting ||
                execution.waiting ||
                interruption.waiting ||
                !connected ||
                order.length === 0
              }
              onClick={() => {
                void (running ? interrupt() : run({})).catch(() => {});
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {starting ? (
                  <circle
                    className="kernel-spinner-stroke"
                    cx="8"
                    cy="8"
                    r="5"
                    strokeDasharray="23 9"
                  />
                ) : running ? (
                  <rect x="4" y="4" width="8" height="8" />
                ) : (
                  <path d="m5 3 7 5-7 5Z" />
                )}
              </svg>
            </button>
          )}
        </div>
      </header>
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
                          run: () => model.edit((edit) => edit.deleteCell(cellId)),
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
                  outputs={Cells.forCell(state, selection, cellId)}
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
