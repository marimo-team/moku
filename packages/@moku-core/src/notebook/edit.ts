/** Compile edits against observed cells into an atomic protocol request. @module */
import { Schema } from "effect";
import type * as Notebook from "../Notebook.ts";
import * as Protocol from "../Protocol.ts";
import { ModelError } from "../internal/client.ts";

const invalid = (message: string): never => {
  throw new ModelError({ reason: "invalid-edit", message });
};
const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function build(
  id: string,
  reserved: Set<string>,
  callback: Notebook.Edit,
): Protocol.EditRequest {
  const changes = new Map<string, Protocol.Change>();
  let order: Extract<Protocol.Change, { kind: "set_order" }> | undefined;
  let active = true;
  const deleted = new Set<string>();
  const cancelled = new Set<string>();
  const check = () => {
    if (!active) invalid("The transaction has ended.");
  };
  const observed = (cell: Protocol.CellOutput | Protocol.CellId) => {
    check();
    if (typeof cell !== "string" && cell.notebook_id !== id)
      invalid("The cell belongs to another notebook.");
    const key = typeof cell === "string" ? cell : cell.id;
    const previous = changes.get(key);
    if (previous?.kind === "delete_cell")
      invalid("The cell was deleted in this transaction.");
    if (
      typeof cell === "string" &&
      !(previous?.kind === "put_cell" && previous.base_etag === null)
    )
      invalid("Only newly created cells can be edited by ID.");
    if (
      typeof cell !== "string" &&
      previous?.kind === "put_cell" &&
      previous.base_etag !== cell.etag
    )
      invalid("Updates must use the same observed cell version.");
    return { key, previous };
  };
  const transaction: Notebook.Transaction = {
    updateCell(cell, patch) {
      const { key, previous } = observed(cell);
      const base =
        previous?.kind === "put_cell"
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
      changes.set(key, {
        ...(previous?.kind === "put_cell" ? previous : {}),
        kind: "put_cell",
        base_etag:
          previous?.kind === "put_cell"
            ? previous.base_etag
            : typeof cell !== "string"
              ? cell.etag
              : null,
        cell: input,
      });
    },
    createCell(input, placement = {}) {
      check();
      if (placement.before !== undefined && placement.after !== undefined)
        invalid("Specify either before or after.");
      let cellId = input.id;
      if (!cellId) {
        for (let attempt = 0; attempt < 100; attempt++) {
          const bytes = crypto.getRandomValues(new Uint8Array(4));
          const value = Array.from(
            bytes,
            (byte) => alphabet[byte % alphabet.length],
          ).join("");
          if (!reserved.has(value)) {
            cellId = Schema.decodeUnknownSync(Protocol.CellId)(value);
            break;
          }
        }
      }
      if (!cellId) return invalid("Could not generate a unique cell ID.");
      if (changes.has(cellId))
        return invalid("The cell already exists in this transaction.");
      reserved.add(cellId);
      deleted.delete(cellId);
      cancelled.delete(cellId);
      const cell = Schema.decodeUnknownSync(Protocol.CellInput)({
        ...input,
        id: cellId,
      });
      changes.set(cellId, {
        kind: "put_cell",
        base_etag: null,
        cell,
        ...(placement.before === undefined ? {} : { before: placement.before }),
        ...(placement.after === undefined ? {} : { after: placement.after }),
      });
      return cellId;
    },
    deleteCell(cell) {
      const { key, previous } = observed(cell);
      deleted.add(key);
      if (order) order = { ...order, order: order.order.filter((id) => id !== key) };
      if (previous?.kind === "put_cell" && previous.base_etag === null) {
        cancelled.add(key);
        changes.delete(key);
        return;
      }
      if (typeof cell === "string") return invalid("The cell is unavailable.");
      changes.set(key, { kind: "delete_cell", id: cell.id, base_etag: cell.etag });
    },
    setOrder(document, ids) {
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
    const removed = new Set<string>();
    const compiled: Protocol.Change[] = [];
    for (const change of changes.values()) {
      if (change.kind === "delete_cell") removed.add(change.id);
      if (change.kind === "put_cell") {
        const { before, after, ...put } = change;
        if (order) {
          compiled.push(put);
          continue;
        }
        const anchor = before ?? after;
        if (anchor !== undefined && (cancelled.has(anchor) || removed.has(anchor)))
          invalid("A placement anchor was deleted in this transaction.");
      }
      compiled.push(change);
    }
    return { changes: [...compiled, ...(order ? [order] : [])] };
  } finally {
    active = false;
  }
}
export function result(response: Protocol.EditResponseOutput): Notebook.EditResult {
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
