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
import * as SmartCells from "@marimo-team/smart-cells";
import * as Cypher from "./cypher.ts";
import * as WidgetCell from "./widgetCell.ts";

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
    # Reconnect instead of reusing a connection that sat idle long enough for
    # the network to drop it, which otherwise stalls the next query forever.
    max_connection_lifetime=60,
)`;

/** Kinds of cell the view can add; Cypher, Python, and the smart cells. */
const kinds = ["Cypher", "Python", "SQL", "Markdown"] as const;
type Kind = (typeof kinds)[number];

/** Starting code for each kind other than Cypher, which needs the widget cell. */
const starters: Record<Exclude<Kind, "Cypher">, string> = {
  Python: "",
  SQL: SmartCells.SQLParser.fromQuery("SELECT 1"),
  Markdown: new SmartCells.MarkdownParser().defaultCode,
};

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
  let widgetCell: string | undefined;
  for (const id of order) {
    const code = document?.cells.get(id)?.code ?? "";
    const projected = Cypher.read(code);
    if (projected) cypher.set(id, projected);
    else if (widgetCell === undefined && WidgetCell.versionOf(code)) widgetCell = id;
  }
  const defined = definedNames(state, document, cypher);

  // The widget cell goes first, so it reads as notebook setup.
  const addWidget = (edit: EditorDocument.Editor) => {
    if (widgetCell !== undefined) return;
    const first = order[0];
    edit.createCell(
      { code: WidgetCell.source, config: { hide_code: true } },
      first ? { before: first } : undefined,
    );
  };
  /** Inserts a cell, first adding a missing widget cell when `widget` is set. */
  const insert = (
    code: string,
    anchor?: string,
    position: "before" | "after" = "after",
    { widget = false }: { widget?: boolean } = {},
  ) => {
    documentModel.edit((edit) => {
      if (widget) addWidget(edit);
      const id = edit.createCell({ code }, anchor ? { [position]: anchor } : undefined);
      navigation.focus(id);
    });
  };
  const insertCypher = (anchor?: string, position: "before" | "after" = "after") =>
    insert(Cypher.create(), anchor, position, { widget: true });
  /** Inserts a cell of `kind`, first importing marimo when a smart cell needs `mo`. */
  const insertKind = (
    kind: Kind,
    anchor?: string,
    position: "before" | "after" = "after",
  ) => {
    if (kind === "Cypher") return insertCypher(anchor, position);
    documentModel.edit((edit) => {
      if (kind !== "Python" && !defined.has("mo")) {
        const first = order[0];
        edit.createCell(
          { code: "import marimo as mo" },
          first ? { before: first } : undefined,
        );
      }
      const id = edit.createCell(
        // Like marimo, Markdown shows its rendered output and opens its source on focus.
        {
          code: starters[kind],
          config: kind === "Markdown" ? { hide_code: true } : {},
        },
        anchor ? { [position]: anchor } : undefined,
      );
      navigation.focus(id);
    });
  };
  const menuInsert = (cellId: string, fallback: Kind) =>
    canEdit
      ? {
          pending: false,
          kinds,
          at: (position: "before" | "after", kind?: string) =>
            insertKind(
              kinds.find((entry) => entry === kind) ?? fallback,
              cellId,
              position,
            ),
        }
      : undefined;
  const runCell = (cellId: string, advance: boolean) => {
    // The host runs ancestors that never ran but not ones edited since, so a
    // renamed Cypher result would otherwise be undefined downstream.
    const stale = staleAncestors(state.analysis?.cells ?? {}, currentness, cellId);
    void run({ cellIds: [...stale, cellId] })
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
            <button
              onClick={() =>
                insert(connectionCell, order[0], "before", { widget: true })
              }
            >
              Add connection cell
            </button>
          </section>
        )}
        {ready && canEdit && cypher.size > 0 && widgetCell === undefined && (
          <section className="neo4j-connect" aria-label="Neo4j widget">
            <p>
              Cypher cells display their results with <code>{Cypher.widget}</code>,
              which a generated cell defines once per notebook.
            </p>
            <button onClick={() => documentModel.edit(addWidget)}>
              Add widget cell
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
              if (cellId === widgetCell)
                return (
                  <WidgetRow
                    key={cellId}
                    code={cell.code ?? ""}
                    outputs={shared.outputs}
                    update={
                      canEdit
                        ? () =>
                            documentModel.edit((edit) =>
                              edit.setCode(cellId, WidgetCell.source),
                            )
                        : undefined
                    }
                  />
                );
              const projected = cypher.get(cellId);
              return projected ? (
                <CypherCell
                  key={cellId}
                  {...shared}
                  notebook={notebook}
                  variables={state.variables}
                  cypher={projected}
                  insert={menuInsert(cellId, "Cypher")}
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
                  insert={(() => {
                    const menu = menuInsert(cellId, "Python");
                    return menu && { ...menu, last: false };
                  })()}
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
            {kinds.map((kind) => (
              <button
                key={kind}
                className={kind === "Cypher" ? "primary" : undefined}
                onClick={() => insertKind(kind, order.at(-1))}
              >
                + {kind}
              </button>
            ))}
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

/**
 * The generated cell defining `CypherGraph`, shown as one line instead of its source.
 *
 * Offers to replace the cell when this build generates a different version.
 */
function WidgetRow({
  code,
  outputs,
  update,
}: {
  code: string;
  outputs: CellOutputs.CellOutputs;
  update?: () => void;
}) {
  const current = WidgetCell.isCurrent(code);
  return (
    <article className="cell neo4j-widget-cell" aria-label="CypherGraph widget cell">
      <span className="cell-margin" aria-hidden="true" />
      <div className="cell-body">
        <div className="neo4j-widget-row">
          <code>{Cypher.widget}</code>
          <span>widget {WidgetCell.versionOf(code)}</span>
          {!current && <span className="cypher-stale">Outdated</span>}
          {!current && update && <button onClick={update}>Update</button>}
        </div>
        <Outputs.CellOutputs {...outputs} />
      </div>
    </article>
  );
}

/** Public names bound anywhere in the notebook, so Cypher cells avoid redefinitions. */
/**
 * Cells that `cellId` reads from, directly or through other cells, whose
 * source changed after their last run.
 */
function staleAncestors(
  analysis: Readonly<
    Record<
      string,
      { readonly defs: readonly string[]; readonly refs: readonly string[] }
    >
  >,
  currentness: (id: string) => Currentness.Reason | null,
  cellId: string,
): string[] {
  const definers = new Map<string, string[]>();
  for (const [id, cell] of Object.entries(analysis))
    for (const name of cell.defs)
      definers.set(name, [...(definers.get(name) ?? []), id]);
  const seen = new Set([cellId]);
  const queue = [cellId];
  const stale: string[] = [];
  for (let id = queue.shift(); id !== undefined; id = queue.shift())
    for (const name of analysis[id]?.refs ?? [])
      for (const definer of definers.get(name) ?? []) {
        if (seen.has(definer)) continue;
        seen.add(definer);
        queue.push(definer);
        if (currentness(definer) === "Source changed") stale.push(definer);
      }
  return stale;
}

function definedNames(
  state: Notebook.State,
  document: EditorDocument.EditableDocument | null,
  cypher: ReadonlyMap<string, Cypher.Cell>,
): Set<string> {
  const names = new Set<string>();
  for (const variable of Object.values(state.variables)) names.add(variable.name);
  for (const cell of Object.values(state.analysis?.cells ?? {}))
    for (const name of cell.defs) names.add(name);
  for (const cell of cypher.values())
    if (!Cypher.isPrivate(cell.metadata.variable)) names.add(cell.metadata.variable);
  // Analysis lags behind local edits, so also catch top-level assignments in drafts.
  for (const id of document?.order ?? [])
    for (const match of (document?.cells.get(id)?.code ?? "").matchAll(
      /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/gm,
    ))
      names.add(match[1]!);
  return names;
}
