/** Compile edits against observed cells into an atomic protocol request. @module */
import { Schema } from "effect";

import { ModelError } from "../internal/client.ts";
import * as Notebook from "../Notebook.ts";
import * as Protocol from "../Protocol.ts";

const invalid = (message: string): never => {
  throw new ModelError({ reason: "invalid-edit", message });
};
export function build(
  id: string,
  reserved: Set<string>,
  callback: Notebook.Edit,
  document: Notebook.Document | null,
): typeof Protocol.EditRequest.Type {
  const changes = new Map<string, typeof Protocol.Change.Type>();
  let order: Extract<typeof Protocol.Change.Type, { kind: "set_order" }> | undefined;
  let active = true;
  const deleted = new Set<string>();
  const placements = new Map<string, Notebook.Placement>();
  const check = () => {
    if (!active) invalid("The transaction has ended.");
  };
  const observed = (cell: typeof Protocol.Cell.Type | typeof Protocol.CellId.Type) => {
    check();
    if (typeof cell !== "string" && cell.notebook_id !== id)
      invalid("The cell belongs to another notebook.");
    const key = typeof cell === "string" ? cell : cell.id;
    const previous = changes.get(key);
    if (previous?.kind === "delete_cell")
      invalid("The cell was deleted in this transaction.");
    if (typeof cell === "string" && previous?.kind !== "create_cell")
      invalid("Only newly created cells can be edited by ID.");
    if (
      typeof cell !== "string" &&
      (previous?.kind === "create_cell" ||
        (previous?.kind === "replace_cell" && previous.base_etag !== cell.etag))
    )
      invalid("Updates must use the same observed cell version.");
    return { key, previous };
  };
  const transaction: Notebook.Transaction = {
    update(cell, patch) {
      const { key, previous } = observed(cell);
      const base =
        previous?.kind === "replace_cell" || previous?.kind === "create_cell"
          ? previous.cell
          : typeof cell !== "string"
            ? cell
            : undefined;
      if (!base) return invalid("The cell is unavailable.");
      const code = patch.code ?? base.code;
      if (code === null) return invalid("Supply code when the host withholds source.");
      const input = Schema.decodeUnknownSync(Protocol.CellInput)({
        id: key,
        code,
        name: patch.name ?? base.name ?? "_",
        config: {
          ...base.config,
          ...Object.fromEntries(
            Object.entries(patch.config ?? {}).filter(
              ([, value]) => value !== undefined,
            ),
          ),
        },
      });
      if (typeof cell === "string")
        changes.set(key, { kind: "create_cell", cell: input });
      else
        changes.set(key, { kind: "replace_cell", base_etag: cell.etag, cell: input });
    },
    insert(input, placement = {}) {
      check();
      if (placement.before !== undefined && placement.after !== undefined)
        invalid("Specify either before or after.");
      const cellId = input.id ?? Notebook.createCellId((id) => reserved.has(id));
      if (changes.has(cellId))
        return invalid("The cell already exists in this transaction.");
      reserved.add(cellId);
      deleted.delete(cellId);

      const cell = Schema.decodeUnknownSync(Protocol.CellInput)({
        ...input,
        id: cellId,
      });
      changes.set(cellId, { kind: "create_cell", cell });
      if (placement.before !== undefined || placement.after !== undefined)
        placements.set(cellId, placement);
      return cellId;
    },
    remove(cell) {
      const { key, previous } = observed(cell);
      deleted.add(key);
      if (order) order = { ...order, order: order.order.filter((id) => id !== key) };
      if (previous?.kind === "create_cell") {
        placements.delete(key);
        changes.delete(key);
        return;
      }
      if (typeof cell === "string") return invalid("The cell is unavailable.");
      // Removing an updated cell discards its patch, but the removal still happens
      // here, after any intervening insertions that use the cell as an anchor.
      changes.delete(key);
      changes.set(key, { kind: "delete_cell", id: cell.id, base_etag: cell.etag });
    },
    reorder(document, ids) {
      check();
      if (document.notebook_id !== id)
        invalid("The document belongs to another notebook.");
      if (new Set(ids).size !== ids.length)
        invalid("The order contains duplicate cell IDs.");
      order = { kind: "set_order", base_etag: document.order_etag, order: [...ids] };
    },
  };
  try {
    const returned: unknown = callback(transaction);
    if (returned instanceof Promise) {
      returned.catch(() => undefined);
      invalid("The edit callback must be synchronous.");
    }
    if (order?.order.some((id) => deleted.has(id)))
      invalid("The order contains a deleted cell.");
    if (!order && placements.size > 0) {
      if (!document)
        return invalid("Placing a cell requires an observed document order.");
      const ids = [...document.order];
      for (const change of changes.values()) {
        if (change.kind === "create_cell") {
          const placement = placements.get(change.cell.id);
          const anchor = placement?.before ?? placement?.after;
          if (anchor === undefined) ids.push(change.cell.id);
          else {
            const index = ids.indexOf(anchor);
            if (index < 0) return invalid("The placement anchor is unavailable.");
            ids.splice(
              index + (placement?.after === undefined ? 0 : 1),
              0,
              change.cell.id,
            );
          }
        } else if (change.kind === "delete_cell") {
          const index = ids.indexOf(change.id);
          if (index >= 0) ids.splice(index, 1);
        }
      }
      order = { kind: "set_order", base_etag: document.order_etag, order: ids };
    }
    return { changes: [...changes.values(), ...(order ? [order] : [])] };
  } finally {
    active = false;
  }
}
export function result(
  response: typeof Protocol.EditResponse.Type,
): Notebook.EditResult {
  return {
    document: response.document,
    cells: Object.entries(response.cells).flatMap(([id, version]) =>
      version
        ? [
            {
              id: Schema.decodeUnknownSync(Protocol.CellId)(id),
              notebook_id: response.document.notebook_id,
              etag: version.etag,
            },
          ]
        : [],
    ),
  };
}
