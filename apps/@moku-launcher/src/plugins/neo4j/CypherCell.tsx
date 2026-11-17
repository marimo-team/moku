import { useAtomValue } from "@effect/atom-react";
import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import * as React from "react";
import type * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/Protocol";
import type * as Document from "@moku/editor/Document";
import { CellOutputs } from "@moku/outputs";
import type * as Outputs from "../notebook/outputs.ts";
import type * as Currentness from "../notebook/currentness.ts";
import { CellMenu } from "../notebook/cells/CellMenu.tsx";
import { CypherEditor } from "./CypherEditor.tsx";
import { GraphView } from "./GraphView.tsx";
import { ResultTables } from "./ResultTables.tsx";
import * as Cypher from "./cypher.ts";
import * as Graph from "./graph.ts";

type Tab = "graph" | "nodes" | "relationships" | "records";

/** A cell whose driver call is edited as Cypher and whose result is drawn as a graph. */
export function CypherCell({
  notebook,
  cell,
  cypher,
  outputs,
  result,
  variables,
  focusRequest,
  insert,
  remove,
  rename,
  taken,
  execution,
  currentness,
}: {
  notebook: Notebook.Interface;
  cell: Document.EditableCell;
  cypher: Cypher.Cell;
  outputs: Outputs.CellOutputs;
  /** The cell's latest completed execution in this runtime. */
  result: typeof Protocol.Execution.Type | undefined;
  variables: Notebook.State["variables"];
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
    readonly at: (position: "before" | "after") => void;
  };
  rename?: (variable: string) => void;
  /** Names already defined in the notebook. */
  taken: ReadonlySet<string>;
}) {
  const { variable, driver } = cypher.metadata;
  const name = `Cypher cell ${variable}`;
  const inputs = [
    ...new Set(
      Cypher.interpolations(cypher.cypher).map((field) => field.expression.trim()),
    ),
  ];
  const [focused, setFocused] = React.useState(focusRequest !== undefined);
  React.useLayoutEffect(() => {
    if (focusRequest !== undefined) setFocused(true);
  }, [focusRequest]);

  // Show the graph only for the value this cell's latest execution bound.
  const bound =
    result &&
    Object.values(variables).find(
      (entry) => entry.name === variable && entry.execution_id === result.id,
    );

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
          <VariableName
            value={variable}
            taken={taken}
            onChange={rename}
            disabled={!rename}
          />
          <span className="cypher-driver" title="The neo4j driver this cell queries">
            via <code>{driver}</code>
          </span>
          {inputs.length > 0 && (
            <span className="cypher-inputs" title="Python evaluated into the query">
              {inputs.map((input) => (
                <code key={input}>{input}</code>
              ))}
            </span>
          )}
          {currentness && <span className="cypher-stale">{currentness}</span>}
        </div>
        <div className="cell-source">
          <CypherEditor
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
        {/* Errors and printed output come from the cell's own execution. */}
        <CellOutputs {...outputs} />
        {bound && (
          <CypherResult
            notebook={notebook}
            variable={variable}
            revision={`${bound.revision.execution}:${bound.revision.update}`}
          />
        )}
      </div>
    </article>
  );
}

function CypherResult({
  notebook,
  variable,
  revision,
}: {
  notebook: Notebook.Interface;
  variable: string;
  revision: string;
}) {
  const loaded = useAtomValue(Graph.load({ notebook, variable, revision }));
  const [tab, setTab] = React.useState<Tab>();
  const [selected, setSelected] = React.useState<string>();

  if (AsyncResult.isFailure(loaded)) {
    const error = Cause.squash(loaded.cause);
    return (
      <p className="notice error" role="alert">
        {error instanceof Error ? error.message : "Could not read the query result."}
      </p>
    );
  }
  if (!AsyncResult.isSuccess(loaded)) {
    return (
      <p className="notice" role="status">
        Reading result…
      </p>
    );
  }
  const value = loaded.value;
  // Write-only queries such as MERGE without RETURN have nothing to show.
  if (value.keys.length === 0 && value.nodes.length === 0) return null;
  const hasGraph = value.nodes.length > 0;
  const tabs: readonly { id: Tab; label: string }[] = hasGraph
    ? [
        { id: "graph", label: "Graph" },
        { id: "nodes", label: `Nodes ${value.nodes.length}` },
        { id: "relationships", label: `Relationships ${value.relationships.length}` },
        { id: "records", label: `Records ${value.records.length}` },
      ]
    : [{ id: "records", label: `Records ${value.records.length}` }];
  const active = tabs.some((entry) => entry.id === tab) ? tab! : tabs[0]!.id;

  return (
    <section className="cypher-result" aria-label={`Result of ${variable}`}>
      <div className="cypher-tabs" role="tablist">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={entry.id === active}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
        {value.truncated && (
          <span className="cypher-truncated">
            Showing the first {Graph.limit.toLocaleString()} of each
          </span>
        )}
      </div>
      <div role="tabpanel">
        {active === "graph" ? (
          <GraphView result={value} selected={selected} onSelect={setSelected} />
        ) : (
          <ResultTables
            table={active}
            result={value}
            selected={selected}
            onSelect={setSelected}
          />
        )}
      </div>
    </section>
  );
}

/** An inline field that renames the variable a Cypher cell binds. */
function VariableName({
  value,
  taken,
  onChange,
  disabled,
}: {
  value: string;
  taken: ReadonlySet<string>;
  onChange?: (value: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const problem = !Cypher.isPublicVariable(draft)
    ? "Use a Python name that does not start with an underscore."
    : draft !== value && taken.has(draft)
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
      title={problem ?? "The Python variable bound to this query's result"}
      aria-invalid={problem !== undefined}
      spellCheck={false}
      size={Math.max(4, draft.length)}
      value={draft}
      disabled={disabled}
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
