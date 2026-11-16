/** Grid addresses such as `B2`, which double as marimo cell and variable names. @module */

/** A zero-based grid position. */
export interface Position {
  readonly col: number;
  readonly row: number;
}

/** The grid never shrinks below this size, and grows to fit the cells it holds. */
export const minimum = { cols: 10, rows: 30 } as const;

/** Columns are single letters, so the grid ends at `Z`. */
export const limit = { cols: 26, rows: 999 } as const;

const pattern = /^([A-Z])([1-9]\d{0,2})$/;

/** Reads an address, or returns null for any other cell name. */
export function parse(name: string): Position | null {
  const match = pattern.exec(name);
  if (!match) return null;
  return { col: match[1]!.charCodeAt(0) - 65, row: Number(match[2]) - 1 };
}

/** The letter heading a column. */
export function column(col: number): string {
  return String.fromCharCode(65 + col);
}

/** The address of a position inside the grid limits. */
export function format({ col, row }: Position): string {
  return `${column(col)}${row + 1}`;
}

/** Moves a position by whole cells, staying inside the given grid size. */
export function move(
  position: Position,
  delta: Partial<Position>,
  size: { readonly cols: number; readonly rows: number },
): Position {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max - 1);
  return {
    col: clamp(position.col + (delta.col ?? 0), size.cols),
    row: clamp(position.row + (delta.row ?? 0), size.rows),
  };
}
