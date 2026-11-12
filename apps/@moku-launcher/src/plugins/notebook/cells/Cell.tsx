import type * as Document from "@moku/editor/Document";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CodeEditor } from "./CodeEditor.tsx";
import { CellOutputs } from "@moku/outputs";
import * as Outputs from "../outputs.ts";
import { CellMenu } from "./CellMenu.tsx";
import * as Source from "./source.ts";
import type * as Currentness from "../currentness.ts";

export function Cell({
  cell,
  outputs,
  preferenceKey,
  focusRequest,
  insert,
  remove,
  execution,
  currentness,
  hasResult,
}: {
  cell: Document.EditableCell;
  hasResult: boolean;
  currentness: Currentness.Reason | null;
  outputs: Outputs.CellOutputs;
  preferenceKey: string;
  focusRequest?: number;
  execution?: {
    readonly running: boolean;
    readonly disabled: boolean;
    readonly run: (advance?: boolean) => void;
  };
  remove?: {
    readonly pending: boolean;
    readonly run: () => void;
  };
  insert?: {
    readonly pending: boolean;
    readonly last: boolean;
    readonly at: (position: "before" | "after") => void;
  };
}) {
  const sourceId = useId();
  const margin = useRef<HTMLButtonElement>(null);
  const source = useMemo(() => Source.read(cell.code ?? ""), [cell.code]);
  const [preference, setPreference] = useState<boolean | undefined>(() => {
    try {
      const saved = localStorage.getItem(preferenceKey);
      return saved === null ? undefined : saved === "pinned";
    } catch {
      return undefined;
    }
  });
  const [focused, setFocused] = useState(focusRequest !== undefined);
  useLayoutEffect(() => {
    if (focusRequest !== undefined) setFocused(true);
  }, [focusRequest]);
  const pinned =
    preference ?? (!cell.config.hide_code && source.language !== "markdown");
  const visible = cell.code !== null && (!hasResult || pinned || focused);
  const name = cell.name === "_" ? `${source.language} cell` : cell.name;

  function pin(value: boolean) {
    setPreference(value);
    try {
      localStorage.setItem(preferenceKey, value ? "pinned" : "hidden");
    } catch {
      // This preference still works for this visit if storage is unavailable.
    }
  }

  const runButton = execution && (
    <button
      className="cell-run"
      aria-label={
        execution.running
          ? "Running cell"
          : currentness
            ? `Run cell: ${currentness.toLowerCase()}`
            : "Run cell"
      }
      title={
        execution.running
          ? "Cell is running"
          : `${currentness ? `${currentness} · ` : ""}Run cell (⌘/Ctrl+Enter or Shift+Enter)`
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
  );

  return (
    <article
      className="cell"
      aria-label={name}
      data-language={source.language}
      data-source-visible={visible}
      data-source-pinned={pinned}
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
        // CodeMirror may replace its focused DOM during an effect cleanup.
        requestAnimationFrame(() => {
          if (!article.contains(article.ownerDocument.activeElement)) {
            setFocused(false);
          }
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setFocused(false);
          margin.current?.focus();
        }
      }}
    >
      {cell.code !== null && (
        <button
          ref={margin}
          className="cell-margin"
          aria-label={`${focused ? "Leave" : "Focus"} ${name} source`}
          title={focused ? "Leave cell (Esc)" : "Show source (Enter)"}
          aria-expanded={visible}
          aria-controls={sourceId}
          onClick={() => setFocused(!focused)}
        />
      )}
      {insert && (
        <>
          <InsertCellButton
            position="before"
            pending={insert.pending}
            onClick={() => insert.at("before")}
          />
          {insert.last && (
            <InsertCellButton
              position="after"
              pending={insert.pending}
              onClick={() => insert.at("after")}
            />
          )}
        </>
      )}
      <CellMenu
        name={name}
        sourceVisible={visible}
        insert={insert}
        onToggleSource={
          cell.code === null || !hasResult
            ? undefined
            : () => {
                setFocused(false);
                pin(!visible);
              }
        }
        remove={remove}
      />
      <div className="cell-body">
        {!visible && runButton}
        {(cell.name !== "_" || cell.config.disabled) && (
          <div className="cell-meta">
            {cell.name !== "_" && <span>{cell.name}</span>}
            {cell.config.disabled && <span>Disabled</span>}
          </div>
        )}
        {!visible && cell.code !== null && !Outputs.hasContent(outputs) && (
          <button
            className="cell-placeholder"
            aria-label={`Show ${name} source`}
            aria-controls={sourceId}
            onClick={() => setFocused(true)}
          >
            <code>&lt;code&gt;</code>
          </button>
        )}
        {cell.code === null ? (
          <p className="notice">Source is not exposed by this host.</p>
        ) : (
          <div id={sourceId} className="cell-source" hidden={!visible}>
            {visible && (
              <>
                <CodeEditor
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
                {execution && runButton}
              </>
            )}
          </div>
        )}
        {!(visible && source.language === "markdown") && <CellOutputs {...outputs} />}
      </div>
    </article>
  );
}

function InsertCellButton({
  position,
  pending,
  onClick,
}: {
  position: "before" | "after";
  pending: boolean;
  onClick: () => void;
}) {
  const label = `Insert cell ${position === "before" ? "above" : "below"}`;
  return (
    <button
      className="cell-insert"
      data-position={position}
      aria-label={label}
      title={label}
      disabled={pending}
      onClick={onClick}
    >
      <span className="cell-insert-icon" aria-hidden="true">
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M3 8h10M8 3v10" />
        </svg>
      </span>
    </button>
  );
}
