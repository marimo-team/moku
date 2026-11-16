/**
 * Placement of a notebook's cells on the grid, by cell name.
 *
 * A cell named by an address, such as `B2`, is that grid cell. A cell named
 * `chart_` and an address, such as `chart_F3`, floats over the grid with its
 * top-left corner pinned to that address, like a chart in a spreadsheet. A
 * numeric suffix, as in `chart_F3_2`, keeps names unique when charts share an
 * anchor. Every other cell is listed beside the grid.
 *
 * @module
 */
import type * as Document from "@moku/editor/Document";
import * as Address from "./address.ts";

type EditableDocument = NonNullable<Document.State["document"]>;
type EditableCell =
  EditableDocument["cells"] extends ReadonlyMap<string, infer Cell> ? Cell : never;

/** Where each cell of a notebook appears in the Sheet view. */
export interface Layout {
  /** Cells whose name is a grid address, by that address. */
  readonly cells: ReadonlyMap<string, EditableCell>;
  /** The same cells by cell id. */
  readonly placed: ReadonlyMap<string, EditableCell>;
  /** Cells that float over the grid, in notebook order. */
  readonly charts: readonly Chart[];
  /** Cells with any other name, in notebook order. They are listed beside the grid. */
  readonly others: readonly EditableCell[];
  /** The grid size, large enough for every placed cell. */
  readonly size: { readonly cols: number; readonly rows: number };
}

/** A cell whose output floats over the grid, pinned at an address. */
export interface Chart {
  readonly cell: EditableCell;
  readonly anchor: Address.Position;
}

const chartPattern = /^chart_([A-Z][1-9]\d{0,2})(?:_\d+)?$/;

/** The name for a chart pinned at the position, unique among the given names. */
export function chartName(
  anchor: Address.Position,
  taken: ReadonlySet<string>,
): string {
  const base = `chart_${Address.format(anchor)}`;
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

/** Places the cells of a draft document, or returns an empty grid before it loads. */
export function of(document: EditableDocument | null): Layout {
  const cells = new Map<string, EditableCell>();
  const placed = new Map<string, EditableCell>();
  const others: EditableCell[] = [];
  const charts: Chart[] = [];
  let cols: number = Address.minimum.cols;
  let rows: number = Address.minimum.rows;
  for (const id of document?.order ?? []) {
    const cell = document?.cells.get(id);
    if (!cell) continue;
    const pinned = chartPattern.exec(cell.name);
    const anchor = pinned ? Address.parse(pinned[1]!) : null;
    if (anchor) {
      charts.push({ cell, anchor });
      cols = Math.max(cols, anchor.col + 1);
      rows = Math.max(rows, Math.min(anchor.row + 12, Address.limit.rows));
      continue;
    }
    const position = Address.parse(cell.name);
    if (!position || cells.has(cell.name)) {
      others.push(cell);
      continue;
    }
    cells.set(cell.name, cell);
    placed.set(cell.id, cell);
    cols = Math.max(cols, position.col + 1);
    // Keep an empty row below the last value so the sheet can always grow.
    rows = Math.max(rows, Math.min(position.row + 2, Address.limit.rows));
  }
  return { cells, placed, charts, others, size: { cols, rows } };
}
