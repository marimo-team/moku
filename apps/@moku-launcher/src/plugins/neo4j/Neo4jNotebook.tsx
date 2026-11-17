import { empty } from "../empty.ts";
import { useAtom, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as React from "react";
import type { ViewProps } from "@moku/plugin";
import type * as Notebook from "@moku/core/Notebook";
import type * as EditorDocument from "@moku/editor/Document";
import * as Outputs from "@moku/outputs";
import * as Model from "../notebook/model.ts";
import * as CellOutputs from "../notebook/outputs.ts";
import * as Currentness from "../notebook/currentness.ts";
import * as Theme from "../notebook/appearance/theme.ts";
import { DocumentContext, useDocument } from "../notebook/DocumentContext.ts";
import { useDraftNavigationGuard } from "../notebook/useDraftNavigationGuard.ts";
import { useCellNavigation } from "../notebook/cells/useCellNavigation.ts";
import { Cell } from "../notebook/cells/Cell.tsx";
import { KernelStartupNotice } from "../notebook/KernelStartupNotice.tsx";
import { NotebookToolbar } from "../notebook/NotebookToolbar.tsx";
import { NotificationList } from "../notebook/feedback/NotificationList.tsx";
import { useNotebookNotifications } from "../notebook/feedback/useNotebookNotifications.ts";
import { useNotebookShortcuts } from "../notebook/useNotebookShortcuts.ts";
import { CypherCell } from "./CypherCell.tsx";
import * as Cypher from "./cypher.ts";

/** Python that opens a driver from environment variables, defaulting to the public demo. */
const connectionCell = `import os
import neo4j

# Neo4j's public, read-only movies database; set NEO4J_* to use your own.
driver = neo4j.GraphDatabase.driver(
    os.environ.get("NEO4J_URI", "neo4j+s://demo.neo4jlabs.com"),
    auth=(
        os.environ.get("NEO4J_USER", "movies"),
        os.environ.get("NEO4J_PASSWORD", "movies"),
    ),
)`;

/** A notebook where `driver.execute_query` cells are edited as Cypher and shown as graphs. */
export function Neo4jNotebook({ notebook }: ViewProps) {
  const result = useAtomValue(Model.forNotebook(notebook));
  const appearance = useAtomValue(Theme.appearance);
  React.useEffect(() => {
    Outputs.setTheme(appearance);
  }, [appearance]);
  return (
    <div className="moku-notebook neo4j-notebook" data-theme={appearance}>
      {AsyncResult.isSuccess(result) ? (
        <DocumentContext value={result.value.document}>
          <Content notebook={notebook} model={result.value} />
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

function Content({
  notebook,
  model,
}: Pick<ViewProps, "notebook"> & { model: Model.Interface }) {
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
  const kernel = state.runtime;
  const cancelling = cancellation.waiting || kernel?.status === "terminating";
  const starting =
    ready &&
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
  const saveDisabled = saving.waiting || !ready;
  useDraftNavigationGuard(documentModel, unsaved);
  useNotebookShortcuts({ canSave, saveDisabled, save });
  const currentness = Currentness.forNotebook({
    cells: new Map(state.document?.cells.map((cell) => [cell.id, cell]) ?? []),
    variables: new Map(Object.entries(state.variables)),
    executions: new Map(Object.entries(state.executions)),
    results: selection.results,
  });

  const cypher = new Map<string, Cypher.Cell>();
  for (const id of order) {
    const projected = Cypher.read(document?.cells.get(id)?.code ?? "");
    if (projected) cypher.set(id, projected);
  }
  const defined = definedNames(state, document, cypher);

  const insert = (
    code: string,
    anchor?: string,
    position: "before" | "after" = "after",
  ) => {
    documentModel.edit((edit) => {
      const id = edit.createCell({ code }, anchor ? { [position]: anchor } : undefined);
      navigation.focus(id);
    });
  };
  const newCypher = () => Cypher.create(Cypher.nextVariable(defined));
  const runCell = (cellId: string, advance: boolean) => {
    void run({ cellIds: [cellId] })
      .then(() => {
        if (advance) navigation.advance(cellId);
      })
      .catch(() => {});
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
        connection={result}
        save={
          canSave
            ? { pending: saving.waiting, disabled: saveDisabled, onClick: () => save() }
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
                  !ready ||
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
        <header className="neo4j-banner">
          <h1 className="neo4j-title">{state.notebook?.name ?? "Notebook"}</h1>
        </header>
        {ready && canEdit && !defined.has("driver") && (
          <section className="neo4j-connect" aria-label="Neo4j connection">
            <p>
              Cypher cells query a neo4j driver named <code>driver</code>. Add a cell
              that connects to Neo4j&apos;s public movies database, or to your own
              through <code>NEO4J_URI</code>, <code>NEO4J_USER</code>, and{" "}
              <code>NEO4J_PASSWORD</code>.
            </p>
            <button onClick={() => insert(connectionCell, order[0], "before")}>
              Add connection cell
            </button>
          </section>
        )}
        {order.length > 0 && (
          <div className="cells" aria-busy={starting} inert={starting}>
            {order.map((cellId) => {
              const cell = document?.cells.get(cellId);
              if (!cell) return null;
              const active = selection.current.get(cellId);
              const cellRunning = active !== undefined && active.status !== "completed";
              const shared = {
                cell,
                focusRequest:
                  navigation.request?.id === cellId
                    ? navigation.request.sequence
                    : undefined,
                remove: canEdit
                  ? {
                      pending: false,
                      run: () => documentModel.edit((edit) => edit.deleteCell(cellId)),
                    }
                  : undefined,
                hasResult: selection.results.has(cellId),
                currentness: ready ? currentness(cellId) : null,
                execution: canRun
                  ? {
                      running: cellRunning,
                      disabled:
                        cellRunning ||
                        execution.waiting ||
                        !ready ||
                        cell.config.disabled,
                      run: (advance = false) => runCell(cellId, advance),
                    }
                  : undefined,
                outputs: CellOutputs.forCell(state, selection, cellId),
              };
              const projected = cypher.get(cellId);
              return projected ? (
                <CypherCell
                  key={cellId}
                  {...shared}
                  notebook={notebook}
                  cypher={projected}
                  result={selection.results.get(cellId)}
                  variables={state.variables}
                  insert={
                    canEdit
                      ? {
                          pending: false,
                          at: (position) => insert(newCypher(), cellId, position),
                        }
                      : undefined
                  }
                  rename={
                    canEdit
                      ? (variable) =>
                          documentModel.edit((edit) =>
                            edit.setCode(
                              cellId,
                              Cypher.write(projected.cypher, {
                                ...projected.metadata,
                                variable,
                              }),
                            ),
                          )
                      : undefined
                  }
                  taken={defined}
                />
              ) : (
                <Cell
                  key={cellId}
                  {...shared}
                  onHideCodeChange={
                    canEdit
                      ? (hide_code) =>
                          documentModel.edit((edit) =>
                            edit.updateConfig(cellId, { hide_code }),
                          )
                      : undefined
                  }
                  insert={
                    canEdit
                      ? {
                          pending: false,
                          last: false,
                          at: (position) => insert("", cellId, position),
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
        {ready && order.length === 0 && (
          <section className="empty-state">
            <h2>{state.notebook ? "No cells yet." : "Notebook unavailable."}</h2>
          </section>
        )}
        {canEdit && (
          <div className="neo4j-add" role="group" aria-label="Add a cell">
            <button
              className="primary"
              onClick={() => insert(newCypher(), order.at(-1))}
            >
              + Cypher
            </button>
            <button onClick={() => insert("", order.at(-1))}>+ Python</button>
          </div>
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
          {cypher.size} Cypher · {order.length} {order.length === 1 ? "cell" : "cells"}
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

/** Names bound anywhere in the notebook, so new Cypher cells avoid redefinitions. */
function definedNames(
  state: Notebook.State,
  document: EditorDocument.EditableDocument | null,
  cypher: ReadonlyMap<string, Cypher.Cell>,
): Set<string> {
  const names = new Set<string>();
  for (const variable of Object.values(state.variables)) names.add(variable.name);
  for (const cell of Object.values(state.analysis?.cells ?? {}))
    for (const name of cell.defs) names.add(name);
  for (const cell of cypher.values()) names.add(cell.metadata.variable);
  // Analysis lags behind local edits, so also catch top-level assignments in drafts.
  for (const id of document?.order ?? [])
    for (const match of (document?.cells.get(id)?.code ?? "").matchAll(
      /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/gm,
    ))
      names.add(match[1]!);
  return names;
}
