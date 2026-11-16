/**
 * The starting code for a new chart, drafted from the selected grid cell.
 *
 * A chart is an ordinary marimo cell, so the draft is plain matplotlib that
 * the person then edits as Python. Its figure and axes use underscore names,
 * which marimo keeps private to the cell, so charts never define the same name.
 *
 * @module
 */
import * as Address from "./address.ts";
import type * as Layout from "./layout.ts";
import type * as Values from "./values.ts";

/** Where a new chart is pinned and the Python that draws it. */
export interface Draft {
  readonly anchor: Address.Position;
  readonly code: string;
}

/**
 * Drafts a chart for the selected cell.
 *
 * When the selection is part of a column of numbers, the chart plots that
 * column, labelled by the nearest column of text to its left and titled by the
 * text above it, and is pinned beside the data. The column ends before a cell
 * computed from the numbers above it, such as a total. Otherwise the chart plots
 * placeholder values next to the selection.
 */
export function draft(
  layout: Layout.Layout,
  values: Values.Selection,
  at: Address.Position,
): Draft {
  const display = (position: Address.Position) => {
    const cell = layout.cells.get(Address.format(position));
    return cell ? values.cells.get(cell.id)?.display : undefined;
  };
  const numeric = (row: number) => {
    const shown = display({ col: at.col, row });
    return shown?.kind === "value" && shown.numeric;
  };
  const anchor = (row: number) => ({
    col: Math.min(at.col + 2, Address.limit.cols - 1),
    row,
  });

  if (!numeric(at.row))
    return {
      anchor: anchor(at.row),
      code: lines("[1, 3, 2, 4]", null),
    };

  // A cell that reads cells of the column, such as a total, ends the data.
  const reads = (row: number, from: number, to: number) => {
    const code = layout.cells.get(Address.format({ col: at.col, row }))?.code ?? "";
    const names = new Set(code.match(/\b[A-Z][1-9]\d{0,2}\b/g));
    for (let other = from; other <= to; other++)
      if (other !== row && names.has(Address.format({ col: at.col, row: other })))
        return true;
    return false;
  };
  let top = at.row;
  while (top > 0 && numeric(top - 1) && !reads(top, top - 1, top - 1)) top -= 1;
  let bottom = at.row;
  while (
    bottom + 1 < layout.size.rows &&
    numeric(bottom + 1) &&
    !reads(bottom + 1, top, bottom)
  )
    bottom += 1;
  const rows = Array.from({ length: bottom - top + 1 }, (_, i) => top + i);
  const list = (col: number) =>
    `[${rows.map((row) => Address.format({ col, row })).join(", ")}]`;

  const text = (position: Address.Position) => {
    const shown = display(position);
    return shown?.kind === "value" && !shown.numeric ? shown.text : null;
  };
  let labels: number | null = null;
  for (let col = at.col - 1; col >= 0 && labels === null; col--)
    if (rows.every((row) => text({ col, row }) !== null)) labels = col;
  const title = top > 0 ? text({ col: at.col, row: top - 1 }) : null;
  const series = labels === null ? list(at.col) : `${list(labels)}, ${list(at.col)}`;
  return { anchor: anchor(top), code: lines(series, title) };
}

function lines(series: string, title: string | null): string {
  return [
    "_fig, _ax = plt.subplots()",
    `_ax.plot(${series}, marker="o")`,
    ...(title === null ? [] : [`_ax.set_title(${JSON.stringify(title)})`]),
    "_fig",
  ].join("\n");
}
