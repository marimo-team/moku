/* Copyright 2026 Marimo. All rights reserved. */

import * as Protocol from "@momo/model/Protocol";
import type { Confirmed as Document } from "@momo/model/Notebook";
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

/** Valid only within a synchronous edit callback. */
export interface Editor {
  setCode(id: Protocol.CellId, code: string): void;
  setName(id: Protocol.CellId, name: string): void;
  updateConfig(id: Protocol.CellId, patch: Partial<Protocol.CellConfigOutput>): void;
  createCell(cell: Protocol.CellInput, placement?: Placement): void;
  deleteCell(id: Protocol.CellId): void;
  setOrder(order: readonly Protocol.CellId[]): void;
}

/** A thrown error rolls back the entire transaction. */
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
