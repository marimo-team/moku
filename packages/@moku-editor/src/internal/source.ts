/** Confirmed notebook content and its private cell lookup index. @module */
import type * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/Protocol";

export interface Source {
  readonly document: Notebook.Document | null;
  readonly canEdit: boolean;
}
const indexes = new WeakMap<
  Notebook.Document,
  ReadonlyMap<string, typeof Protocol.Cell.Type>
>();
export function index(
  document: Notebook.Document,
): ReadonlyMap<string, typeof Protocol.Cell.Type> {
  let cells = indexes.get(document);
  if (!cells) {
    cells = new Map(document.cells.map((cell) => [cell.id, cell]));
    indexes.set(document, cells);
  }
  return cells;
}
