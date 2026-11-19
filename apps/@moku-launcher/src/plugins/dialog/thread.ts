/**
 * Read a conversation out of a notebook's document order.
 *
 * Each dialog cell holds one turn, and the cells the agent creates follow it.
 * A turn's conversation is every turn above it, so reordering cells changes
 * what a new session hears without a separate conversation to keep in sync.
 *
 * @module
 */
import { Option } from "effect";
import * as Transcript from "./transcript.ts";

/** The parts of an editable document that decide a conversation. */
export interface Cells {
  readonly order: readonly string[];
  readonly cells: ReadonlyMap<string, { readonly code: string | null }>;
}

/** A turn and the dialog cell that stores it. */
export interface Entry {
  readonly id: string;
  readonly turn: Transcript.Turn;
}

/**
 * Returns the turns above a position in document order.
 *
 * With `after` set, the turns up to and including that cell are returned, and
 * with null, every turn in the notebook. Dialog cells whose source was edited
 * into another form are skipped.
 */
export function above(document: Cells, after: string | null): readonly Entry[] {
  const entries: Entry[] = [];
  for (const id of document.order) {
    const turn = Transcript.parse(document.cells.get(id)?.code ?? null);
    if (Option.isSome(turn)) entries.push({ id, turn: turn.value });
    if (id === after) break;
  }
  return entries;
}
