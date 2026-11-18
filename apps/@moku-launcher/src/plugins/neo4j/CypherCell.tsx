import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as React from "react";
import type * as Notebook from "@moku/core/Notebook";
import type * as Document from "@moku/editor/Document";
import { CellOutputs } from "@moku/outputs";
import type * as Outputs from "../notebook/outputs.ts";
import type * as Currentness from "../notebook/currentness.ts";
import { CellMenu } from "../notebook/cells/CellMenu.tsx";
import { CypherEditor } from "./CypherEditor.tsx";
import * as Cypher from "./cypher.ts";
import * as Neo4jSchema from "./schema.ts";

/**
 * A cell whose driver call is edited as Cypher.
 *
 * The cell's own output is the `CypherGraph` widget, so the graph and tables
 * arrive with its other outputs.
 */
export function CypherCell({
  notebook,
  variables,
  cell,
  cypher,
  outputs,
  focusRequest,
  insert,
  remove,
  rename,
  taken,
  execution,
  currentness,
}: {
  notebook: Notebook.Interface;
  variables: Notebook.State["variables"];
  cell: Document.EditableCell;
  cypher: Cypher.Cell;
  outputs: Outputs.CellOutputs;
  hasResult: boolean;
  currentness: Currentness.Reason | null;
  focusRequest?: number;
  execution?: {
    readonly running: boolean;
    readonly disabled: boolean;
    readonly run: (advance?: boolean) => void;
  };
  remove?: { readonly pending: boolean; readonly run: () => void };
  insert?: {
    readonly pending: boolean;
    readonly at: (position: "before" | "after", kind?: string) => void;
    readonly kinds?: readonly string[];
  };
  rename?: (variable: string) => void;
  /** Public names defined by other cells. */
  taken: ReadonlySet<string>;
}) {
  const { variable, driver } = cypher.metadata;
  const name = `Cypher cell ${variable}`;
  const driverVariable = Object.values(variables).find(
    (entry) => entry.name === driver,
  );
  const [focused, setFocused] = React.useState(focusRequest !== undefined);
  React.useLayoutEffect(() => {
    if (focusRequest !== undefined) setFocused(true);
  }, [focusRequest]);

  return (
    <article
      className="cell cypher-cell"
      aria-label={name}
      data-language="cypher"
      data-source-visible
      data-source-pinned
      data-focused={focused}
      data-currentness={currentness ?? "Current"}
      data-needs-run={currentness !== null}
      data-runnable={execution !== undefined}
      data-running={execution?.running ?? false}
      onFocus={(event) => {
        if (event.target.closest(".cell-source")) setFocused(true);
      }}
      onBlur={(event) => {
        const article = event.currentTarget;
        if (article.contains(event.relatedTarget)) return;
        requestAnimationFrame(() => {
          if (!article.contains(article.ownerDocument.activeElement)) setFocused(false);
        });
      }}
    >
      <span className="cell-margin" aria-hidden="true" />
      <CellMenu name={name} sourceVisible insert={insert} remove={remove} />
      <div className="cell-body">
        <div className="cypher-header">
          <span className="cypher-badge">Cypher</span>
          <VariableName value={variable} taken={taken} onChange={rename} />
          <span className="cypher-driver" title="The neo4j driver this cell queries">
            via <code>{driver}</code>
          </span>
          {currentness && <span className="cypher-stale">{currentness}</span>}
        </div>
        <div className="cell-source">
          <SchemaEditor
            notebook={notebook}
            driver={driver}
            revision={
              driverVariable &&
              `${driverVariable.revision.execution}:${driverVariable.revision.update}`
            }
            cellId={cell.id}
            autoFocus={focused}
            focusRequest={focusRequest}
            onRun={
              execution
                ? (advance) => {
                    if (!execution.disabled) execution.run(advance);
                  }
                : undefined
            }
          />
          {execution && (
            <button
              className="cell-run"
              aria-label={execution.running ? "Running cell" : "Run query"}
              title={
                execution.running
                  ? "Query is running"
                  : `${currentness ? `${currentness} · ` : ""}Run query (⌘/Ctrl+Enter or Shift+Enter)`
              }
              aria-keyshortcuts="Control+Enter Meta+Enter Shift+Enter"
              disabled={execution.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => execution.run()}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {execution.running ? (
                  <circle cx="8" cy="8" r="4" strokeDasharray="18 8" />
                ) : (
                  <path d="m5 3 7 5-7 5Z" />
                )}
              </svg>
            </button>
          )}
        </div>
        {/* The widget, errors, and printed output come from the cell's own execution. */}
        <CellOutputs {...outputs} />
      </div>
    </article>
  );
}

/**
 * The Cypher editor, completing from the schema behind `driver` once the driver exists.
 *
 * Reading the schema needs a running driver, so there is nothing to complete
 * from until the cell defining it has run.
 */
function SchemaEditor({
  notebook,
  driver,
  revision,
  ...props
}: React.ComponentProps<typeof CypherEditor> & {
  notebook: Notebook.Interface;
  driver: string;
  revision: string | undefined;
}) {
  if (revision === undefined || Cypher.isPrivate(driver))
    return <CypherEditor {...props} />;
  return (
    <LoadedSchemaEditor
      notebook={notebook}
      driver={driver}
      revision={revision}
      {...props}
    />
  );
}

function LoadedSchemaEditor({
  notebook,
  driver,
  revision,
  ...props
}: React.ComponentProps<typeof CypherEditor> & {
  notebook: Notebook.Interface;
  driver: string;
  revision: string;
}) {
  const schema = useAtomValue(Neo4jSchema.load({ notebook, driver, revision }));
  return (
    <CypherEditor
      {...props}
      schema={AsyncResult.isSuccess(schema) ? schema.value : undefined}
    />
  );
}

/** An inline field that renames the variable a Cypher cell binds its result to. */
function VariableName({
  value,
  taken,
  onChange,
}: {
  value: string;
  taken: ReadonlySet<string>;
  onChange?: (value: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const problem = !Cypher.isName(draft)
    ? "Use a Python name."
    : draft !== value && !Cypher.isPrivate(draft) && taken.has(draft)
      ? `${draft} is already defined.`
      : undefined;
  const commit = () => {
    if (problem || draft === value) setDraft(value);
    else onChange?.(draft);
  };
  return (
    <input
      className="cypher-variable"
      aria-label="Result variable"
      title={
        problem ??
        "The query's EagerResult, with records, summary, and keys. Names starting with _ stay local to this cell."
      }
      aria-invalid={problem !== undefined}
      data-private={Cypher.isPrivate(draft)}
      spellCheck={false}
      size={Math.max(4, draft.length)}
      value={draft}
      disabled={!onChange}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}
