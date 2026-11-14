/** Coherent source revisions used to reconcile editor drafts. @module */
import type * as Protocol from "@moku/core/Protocol";
import type * as Notebook from "@moku/core/Notebook";
export interface Confirmed {
  readonly revision: Protocol.DocumentOutput;
  readonly cells: ReadonlyMap<string, Protocol.CellOutput>;
}
export interface Source {
  readonly document: Confirmed | null;
  readonly canEdit: boolean;
}
const snapshots = new WeakMap<Confirmed, Notebook.Document>();
export function document(confirmed: Confirmed): Notebook.Document {
  const cached = snapshots.get(confirmed);
  if (cached) return cached;
  const snapshot = {
    ...confirmed.revision,
    cells: confirmed.revision.order.map((id) => {
      const cell = confirmed.cells.get(id);
      if (!cell) throw new Error("The confirmed document is incomplete.");
      return cell;
    }),
  };
  snapshots.set(confirmed, snapshot);
  return snapshot;
}
