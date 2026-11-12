/* Copyright 2026 Marimo. All rights reserved. */

/**
 * Synchronous document transactions with atomic publication and rollback.
 *
 * @module
 */
import * as Protocol from "@moku/core/Protocol";
import type { Confirmed as Document } from "@moku/core/Notebook";
import {
  type CellEdit,
  type Draft,
  type Placement,
  createCell,
  deleteCell,
  restoreCell,
  editCell,
  EMPTY_DRAFT,
  setOrder,
  viewDocument,
} from "./draft.ts";

/**
 * Operations available during a synchronous document edit.
 *
 * The editor is valid only inside its callback. Using it after the callback
 * returns throws.
 */
export interface Editor {
  setCode(id: Protocol.CellId, code: string): void;
  setName(id: Protocol.CellId, name: string): void;

  /**
   * Updates the supplied configuration fields, preserving all others.
   */
  updateConfig(id: Protocol.CellId, patch: Partial<Protocol.CellConfigOutput>): void;

  /**
   * Creates a cell before or after an existing cell, or at the end by default.
   */
  createCell(cell: Protocol.CellInput, placement?: Placement): void;
  deleteCell(id: Protocol.CellId): void;

  /**
   * Reorders cells. The order must contain every current cell exactly once.
   */
  setOrder(order: readonly Protocol.CellId[]): void;
}

/**
 * A synchronous edit callback whose changes publish as one transaction.
 *
 * Throwing rolls back all changes. Async callbacks and nested transactions
 * are rejected.
 */
export type Edit = (editor: Editor) => void;

export function editDocument(
  confirmed: Document,
  draft: Draft,
  edit: Edit,
  sent: Draft = EMPTY_DRAFT,
): Draft {
  let next = draft;
  let active = true;

  function assertActive() {
    if (!active) {
      throw new Error("The document transaction has ended");
    }
  }

  function hasCell(id: Protocol.CellId): boolean {
    const local = next.cells.get(id);
    return (
      local?.kind === "create" || (local?.kind !== "delete" && confirmed.cells.has(id))
    );
  }

  function requireCell(id: Protocol.CellId) {
    assertActive();
    if (!hasCell(id)) {
      throw new Error(`Cell ${id} does not exist`);
    }
  }

  function updateCell(id: Protocol.CellId, patch: CellEdit) {
    requireCell(id);
    next = editCell(confirmed, next, id, patch);
  }

  const editor: Editor = {
    setCode: (id, code) => updateCell(id, { code }),
    setName: (id, name) => updateCell(id, { name }),
    updateConfig: (id, patch) =>
      updateCell(id, {
        config: Protocol.CellConfig.strict().partial().parse(patch),
      }),
    createCell: (cell, placement = {}) => {
      assertActive();
      if (hasCell(cell.id)) {
        throw new Error(`Cell ${cell.id} already exists`);
      }
      if (placement.after !== undefined && placement.before !== undefined) {
        throw new Error("Specify either before or after for cell placement");
      }
      const anchor = placement.after ?? placement.before;
      if (anchor !== undefined) {
        requireCell(anchor);
      }
      next = confirmed.cells.has(cell.id)
        ? restoreCell(confirmed, next, cell, { ...placement }, sent)
        : createCell(next, cell, { ...placement });
    },
    deleteCell: (id) => {
      requireCell(id);
      next = deleteCell(next, id, sent);
    },
    setOrder: (order) => {
      assertActive();
      const { cells } = viewDocument(confirmed, next);
      if (
        order.length !== cells.size ||
        new Set(order).size !== cells.size ||
        order.some((id) => !cells.has(id))
      ) {
        throw new Error("Cell order must contain every cell exactly once");
      }
      next = setOrder(next, order);
    },
  };

  try {
    const result: unknown = edit(editor);
    if (result instanceof Promise) {
      // Observe a rejected async callback without publishing its partial draft.
      result.catch(() => undefined);
      throw new Error("Document edit callbacks must be synchronous");
    }
    return next;
  } finally {
    active = false;
  }
}
