import * as React from "react";
import { DisplayView } from "@moku/outputs";
import * as Address from "./address.ts";
import type * as Layout from "./layout.ts";
import type * as Values from "./values.ts";

/** Text being typed into the selected address, in the grid or in the formula bar. */
export interface Editing {
  readonly text: string;
  readonly target: "cell" | "bar";
}

interface GridProps {
  readonly layout: Layout.Layout;
  readonly values: Values.Selection;
  readonly position: Address.Position;
  readonly editing: Editing | null;
  readonly canEdit: boolean;
  readonly container: React.RefObject<HTMLDivElement | null>;
  readonly onSelect: (position: Address.Position) => void;
  /** Starts editing. Null text means the cell's current input. */
  readonly onEdit: (text: string | null) => void;
  readonly onChange: (text: string) => void;
  readonly onCommit: (move?: Partial<Address.Position>) => void;
  readonly onCancel: () => void;
  readonly onClear: () => void;
  /** The chart selected for editing, if any. */
  readonly chart: string | null;
  /** Whether the selected grid cell is the current selection, rather than a cell off the grid. */
  readonly active: boolean;
  readonly onSelectChart: (cellId: string) => void;
  readonly onMoveChart: (cellId: string, anchor: Address.Position) => void;
}

/** The spreadsheet table, with keyboard navigation and in-place editing. */
export function Grid(props: GridProps) {
  const { layout, values, position, editing, container } = props;
  const { cols, rows } = layout.size;
  const charts = new Map<string, Layout.Chart[]>();
  for (const chart of layout.charts) {
    const key = Address.format(chart.anchor);
    charts.set(key, [...(charts.get(key) ?? []), chart]);
  }

  React.useEffect(() => {
    container.current
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [container, position]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (editing?.target === "cell" || event.target !== event.currentTarget) return;
    const step = (delta: Partial<Address.Position>) => {
      event.preventDefault();
      props.onSelect(Address.move(position, delta, layout.size));
    };
    switch (event.key) {
      case "ArrowUp":
        return step({ row: -1 });
      case "ArrowDown":
        return step({ row: 1 });
      case "ArrowLeft":
        return step({ col: -1 });
      case "ArrowRight":
        return step({ col: 1 });
      case "Tab":
        return step({ col: event.shiftKey ? -1 : 1 });
      case "Enter":
      case "F2":
        event.preventDefault();
        return props.onEdit(null);
      case "Backspace":
      case "Delete":
        event.preventDefault();
        return props.onClear();
    }
    // Typing replaces the cell's content, as in a spreadsheet.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      props.onEdit(event.key);
    }
  }

  return (
    <div
      className="sheet-grid"
      ref={container}
      tabIndex={0}
      role="grid"
      aria-label="Sheet"
      aria-rowcount={rows}
      aria-colcount={cols}
      onKeyDown={onKeyDown}
    >
      <table>
        <thead>
          <tr>
            <th className="sheet-corner" />
            {Array.from({ length: cols }, (_, col) => (
              <th key={col} scope="col" data-active={col === position.col || undefined}>
                {Address.column(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => (
            <tr key={row}>
              <th scope="row" data-active={row === position.row || undefined}>
                {row + 1}
              </th>
              {Array.from({ length: cols }, (_, col) => {
                const selected =
                  props.active && col === position.col && row === position.row;
                const address = Address.format({ col, row });
                const pinned = charts.get(address);
                const cell = layout.cells.get(address);
                const value = cell ? values.cells.get(cell.id) : undefined;
                return (
                  <td
                    key={col}
                    role="gridcell"
                    aria-selected={selected}
                    data-address={address}
                    data-anchor={pinned ? true : undefined}
                    data-kind={value?.display.kind}
                    data-numeric={
                      (value?.display.kind === "value" && value.display.numeric) ||
                      undefined
                    }
                    data-busy={value?.busy || undefined}
                    title={
                      value?.display.kind === "error"
                        ? value.display.message
                        : undefined
                    }
                    onMouseDown={() => props.onSelect({ col, row })}
                    onDoubleClick={() => props.onEdit(null)}
                  >
                    {selected && editing?.target === "cell" ? (
                      <CellInput
                        text={editing.text}
                        readOnly={!props.canEdit}
                        onChange={props.onChange}
                        onCommit={props.onCommit}
                        onCancel={props.onCancel}
                      />
                    ) : value?.display.kind === "rich" ? (
                      <div
                        className="sheet-rich"
                        style={{ width: span(layout, { col, row }) * 112 - 12 }}
                      >
                        <DisplayView
                          data={value.display.data}
                          runtimeId={value.display.runtimeId}
                        />
                      </div>
                    ) : (
                      text(value)
                    )}
                    {pinned?.map((chart, index) => (
                      <FloatingChart
                        key={chart.cell.id}
                        value={values.cells.get(chart.cell.id)}
                        offset={index * 16}
                        selected={props.chart === chart.cell.id}
                        movable={props.canEdit}
                        onSelect={() => {
                          props.onSelectChart(chart.cell.id);
                          container.current?.focus({ preventScroll: true });
                        }}
                        onMove={(anchor) => props.onMoveChart(chart.cell.id, anchor)}
                      />
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A chart's output floating over the grid from its anchor cell.
 *
 * Dragging the title bar moves the box with the pointer. Releasing it pins the
 * chart to the cell under the box's top-left corner.
 */
function FloatingChart({
  value,
  offset,
  selected,
  movable,
  onSelect,
  onMove,
}: {
  value: Values.Cell | undefined;
  offset: number;
  selected: boolean;
  movable: boolean;
  onSelect: () => void;
  onMove: (anchor: Address.Position) => void;
}) {
  const grab = React.useRef<{ x: number; y: number; left: number; top: number } | null>(
    null,
  );
  const [shift, setShift] = React.useState<{ x: number; y: number } | null>(null);
  const display = value?.display;
  return (
    <div
      className="sheet-chart"
      role="figure"
      aria-label="Chart"
      aria-selected={selected}
      data-busy={value?.busy || undefined}
      data-dragging={shift ? true : undefined}
      style={{
        top: 2 + offset,
        left: 2 + offset,
        transform: shift ? `translate(${shift.x}px, ${shift.y}px)` : undefined,
      }}
      // Keep the grid from selecting the cell under the chart. The output itself
      // keeps its own pointer behaviour, so widgets in a chart still work.
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button === 0) onSelect();
      }}
    >
      <div
        className="sheet-chart-title"
        // Stop the browser from selecting text while the title bar is dragged.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.button !== 0 || !movable) return;
          const box = event.currentTarget.parentElement?.getBoundingClientRect();
          if (!box) return;
          grab.current = {
            x: event.clientX,
            y: event.clientY,
            left: event.clientX - box.left,
            top: event.clientY - box.top,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = grab.current;
          if (start)
            setShift({ x: event.clientX - start.x, y: event.clientY - start.y });
        }}
        onPointerUp={(event) => {
          const start = grab.current;
          grab.current = null;
          setShift(null);
          const box = event.currentTarget.parentElement;
          if (
            !start ||
            !box ||
            (Math.abs(event.clientX - start.x) < 4 &&
              Math.abs(event.clientY - start.y) < 4)
          )
            return;
          // Look past the box itself for the cell under its new top-left corner.
          box.style.pointerEvents = "none";
          const target = document
            .elementFromPoint(
              event.clientX - start.left + 2,
              event.clientY - start.top + 2,
            )
            ?.closest<HTMLElement>("td[data-address]");
          box.style.pointerEvents = "";
          const anchor = target?.dataset.address
            ? Address.parse(target.dataset.address)
            : null;
          if (anchor) onMove(anchor);
        }}
        onPointerCancel={() => {
          grab.current = null;
          setShift(null);
        }}
        aria-label="Move chart"
        title="Drag to move"
      />
      <div className="sheet-chart-body">
        {display?.kind === "rich" ? (
          <DisplayView data={display.data} runtimeId={display.runtimeId} />
        ) : display?.kind === "error" ? (
          <span className="sheet-chart-error">{display.message}</span>
        ) : display?.kind === "value" && display.text !== "" ? (
          display.text
        ) : (
          <span className="sheet-chart-empty">
            {value?.busy ? "Drawing…" : "Not calculated"}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * How many columns a rich value may cover: its own and the empty ones to its
 * right, as spreadsheet text overflows into empty neighbours.
 */
function span(layout: Layout.Layout, { col, row }: Address.Position): number {
  let count = 1;
  while (
    count < 4 &&
    col + count < layout.size.cols &&
    !layout.cells.has(Address.format({ col: col + count, row }))
  )
    count += 1;
  return count;
}

function text(value: Values.Cell | undefined): string {
  if (!value) return "";
  switch (value.display.kind) {
    case "blank":
      return value.busy ? "…" : "";
    case "rich":
      return "";
    case "value":
    case "formula":
      return value.display.text;
    case "error":
      return value.display.label;
  }
}

function CellInput({
  text,
  readOnly,
  onChange,
  onCommit,
  onCancel,
}: {
  text: string;
  readOnly: boolean;
  onChange: (text: string) => void;
  onCommit: (move?: Partial<Address.Position>) => void;
  onCancel: () => void;
}) {
  // Enter, Tab, and Escape settle the edit themselves, so the blur they cause must not.
  const settled = React.useRef(false);
  const settle = (action: () => void) => {
    settled.current = true;
    action();
  };
  return (
    <input
      autoFocus
      aria-label="Cell input"
      value={text}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => {
        if (!settled.current) onCommit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          settle(() => onCommit({ row: event.shiftKey ? -1 : 1 }));
        } else if (event.key === "Tab") {
          event.preventDefault();
          settle(() => onCommit({ col: event.shiftKey ? -1 : 1 }));
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(onCancel);
        }
      }}
    />
  );
}
