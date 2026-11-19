import type * as Document from "@moku/editor/Document";
import * as React from "react";
import { CodeEditor } from "./CodeEditor.tsx";
import { CellOutputs } from "@moku/outputs";
import * as Outputs from "../outputs.ts";
import { CellMenu } from "./CellMenu.tsx";
import * as Source from "./source.ts";
import type * as Currentness from "../currentness.ts";

export function Cell({
  cell,
  outputs,
  onHideCodeChange,
  focusRequest,
  insert,
  remove,
  execution,
  currentness,
  hasResult,
  selection,
  keyboard,
  move,
  kind,
  preview,
}: {
  cell: Document.EditableCell;
  hasResult: boolean;
  currentness: Currentness.Reason | null;
  outputs: Outputs.CellOutputs;
  onHideCodeChange?: (hidden: boolean) => void;
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
  /**
   * Selection of several cells through the margin.
   *
   * Shift-click selects a range and Cmd/Ctrl-click toggles one cell. While any
   * cell is selected, a plain click toggles too instead of showing the source.
   */
  selection?: {
    readonly selected: boolean;
    readonly active: boolean;
    readonly select: (mode: "toggle" | "range") => void;
  };
  /**
   * Keys handled while the cell's margin has focus.
   *
   * Arrow keys move between cells, Shift extends the selection, Alt moves the
   * cells, Cmd/Ctrl+A selects every cell, and Backspace or Delete removes them.
   */
  keyboard?: {
    readonly navigate: (direction: "up" | "down", extend: boolean) => void;
    readonly selectAll: () => void;
    readonly remove: (() => void) | undefined;
  };
  /** Moves this cell, or the selection that includes it, one place. Absent when cells are read-only. */
  move?: {
    readonly up: (() => void) | undefined;
    readonly down: (() => void) | undefined;
  };
  /** A label from the hosting view, exposed as `data-kind` so it can style the cell. */
  kind?: string;
  /**
   * Content shown in place of the source until the cell has a result.
   *
   * Focusing the cell still shows the source for editing.
   */
  preview?: React.ReactNode;
}) {
  const sourceId = React.useId();
  const margin = React.useRef<HTMLButtonElement>(null);
  const source = React.useMemo(() => Source.read(cell.code ?? ""), [cell.code]);
  const [focused, setFocused] = React.useState(focusRequest !== undefined);
  React.useLayoutEffect(() => {
    if (focusRequest !== undefined) setFocused(true);
  }, [focusRequest]);
  const pinned = !cell.config.hide_code;
  const previewing = preview !== undefined && !hasResult && !focused;
  const visible =
    cell.code !== null && !previewing && (!hasResult || pinned || focused);
  // marimo writes unnamed cells as `_`, and cells created through code mode arrive with no name.
  const named = cell.name !== "" && cell.name !== "_";
  const name = named ? cell.name : `${source.language} cell`;

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
      data-selected={selection?.selected ?? false}
      data-cell-id={cell.id}
      data-kind={kind}
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
          title={
            selection?.active
              ? "Select cell (Shift-click or Shift+↑/↓ for a range, ⌫ deletes)"
              : `${focused ? "Leave cell (Esc)" : "Show source (Enter)"} · ↑/↓ to move between cells, Shift+↑/↓ to select, ⌥↑/↓ to reorder, ⌫ to delete`
          }
          aria-expanded={visible}
          aria-controls={sourceId}
          aria-pressed={selection ? selection.selected : undefined}
          onMouseDown={(event) => {
            // Shift-click would otherwise select the page's text across the range.
            if (event.shiftKey) event.preventDefault();
          }}
          onKeyDown={(event) => {
            if (!keyboard || event.nativeEvent.isComposing) return;
            const vertical =
              event.key === "ArrowUp"
                ? "up"
                : event.key === "ArrowDown"
                  ? "down"
                  : null;
            const mod = event.metaKey || event.ctrlKey;
            if (vertical && event.altKey && move) {
              move[vertical]?.();
            } else if (vertical && !mod) {
              keyboard.navigate(vertical, event.shiftKey);
            } else if (mod && event.key.toLowerCase() === "a") {
              keyboard.selectAll();
            } else if (
              (event.key === "Backspace" || event.key === "Delete") &&
              keyboard.remove
            ) {
              keyboard.remove();
            } else {
              return;
            }
            // The window-level selection shortcuts would otherwise handle the same key.
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            if (selection && event.shiftKey) selection.select("range");
            else if (selection && (event.metaKey || event.ctrlKey || selection.active))
              selection.select("toggle");
            else setFocused(!focused);
          }}
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
        sourceVisible={pinned}
        insert={insert}
        onToggleSource={
          cell.code === null || !hasResult || !onHideCodeChange
            ? undefined
            : () => {
                setFocused(false);
                onHideCodeChange(!cell.config.hide_code);
              }
        }
        remove={remove}
        move={move}
      />
      <div className="cell-body">
        {!visible && runButton}
        {(named || cell.config.disabled) && (
          <div className="cell-meta">
            {named && <span>{cell.name}</span>}
            {cell.config.disabled && <span>Disabled</span>}
          </div>
        )}
        {previewing && preview}
        {!visible &&
          !previewing &&
          cell.code !== null &&
          !Outputs.hasContent(outputs) && (
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
