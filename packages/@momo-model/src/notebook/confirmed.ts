/**
 * Assemble complete document revisions from cell and document events.
 *
 * @module
 */
import type * as Protocol from "../Protocol.ts";

/** The cell records and revision belong to the same complete host update. */
export interface Confirmed {
  readonly revision: Protocol.DocumentOutput;
  readonly cells: ReadonlyMap<string, Protocol.CellOutput>;
}

export interface State {
  readonly current: Confirmed | null;
  readonly pending: {
    readonly revision: Protocol.DocumentOutput | null;
    readonly cells: ReadonlyMap<string, Protocol.CellOutput>;
  } | null;
}

export const initial: State = { current: null, pending: null };

export function reduce(
  state: State,
  event: Protocol.EventOutput,
  phase: "snapshot" | "replay" | "live",
): State {
  const pending = () =>
    state.pending ?? {
      revision: state.current?.revision ?? null,
      cells: state.current?.cells ?? new Map(),
    };
  switch (event.event) {
    case "cell":
      return {
        ...state,
        pending: {
          ...pending(),
          cells: new Map(pending().cells).set(event.data.cell.id, event.data.cell),
        },
      };
    case "cell.removed": {
      const cells = new Map(pending().cells);
      cells.delete(event.data.id);
      return { ...state, pending: { ...pending(), cells } };
    }
    case "document": {
      const next = { revision: event.data.document, cells: pending().cells };
      return phase === "snapshot" ? { ...state, pending: next } : publish(next);
    }
    case "ready":
      if (state.pending === null) return state;
      if (phase !== "snapshot") {
        throw new Error("Stream ended with an incomplete document update");
      }
      return state.pending.revision === null
        ? initial
        : publish({ ...state.pending, revision: state.pending.revision });
    default:
      return state;
  }
}

function publish(document: Confirmed): State {
  const { revision, cells } = document;
  const ids = new Set(revision.order);
  if (
    ids.size !== revision.order.length ||
    ids.size !== cells.size ||
    [...ids].some((id) => !cells.has(id)) ||
    [...cells.values()].some(
      (cell) =>
        cell.notebook_id !== revision.notebook_id || cell.version > revision.version,
    )
  ) {
    throw new Error("Document records do not match its revision");
  }
  return { current: document, pending: null };
}
