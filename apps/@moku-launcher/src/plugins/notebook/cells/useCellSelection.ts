import * as React from "react";

/** How a click changes the selection. */
export type Mode = "toggle" | "range";

/** Selected cells and the cell that ranges start from. */
export interface State {
  readonly ids: ReadonlySet<string>;
  /** The last cell toggled or the start of a keyboard range, or null before either. */
  readonly anchor: string | null;
}

/** The selection with nothing chosen. */
export const empty: State = { ids: new Set(), anchor: null };

function span(order: readonly string[], from: string, to: string) {
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start === -1 || end === -1) return undefined;
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/**
 * Applies a click to the selection.
 *
 * A toggle flips one cell and makes it the anchor. A range adds the cells from
 * the anchor to `id` in document order, and toggles instead when there is no anchor.
 */
export function click(
  state: State,
  order: readonly string[],
  id: string,
  mode: Mode,
): State {
  const range =
    mode === "range" && state.anchor !== null && span(order, state.anchor, id);
  if (range) return { ids: new Set([...state.ids, ...range]), anchor: state.anchor };
  const ids = new Set(state.ids);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids, anchor: id };
}

/**
 * Selects the cells between the anchor and `to`, as Shift with an arrow key does.
 *
 * Without an anchor, `from` becomes one, so the first step selects both the
 * focused cell and its neighbor. Moving back toward the anchor shrinks the range.
 */
export function extend(
  state: State,
  order: readonly string[],
  from: string,
  to: string,
): State {
  const anchor =
    state.anchor !== null && order.includes(state.anchor) ? state.anchor : from;
  const range = span(order, anchor, to);
  return range ? { ids: new Set(range), anchor } : state;
}

/** Selects every cell, keeping the anchor. */
export function all(state: State, order: readonly string[]): State {
  return { ids: new Set(order), anchor: state.anchor ?? order[0] ?? null };
}

/**
 * Cells picked together so they can be moved or deleted at once.
 *
 * Cells that leave the document drop out of the selection.
 */
export function useCellSelection(order: readonly string[]) {
  const [state, setState] = React.useState<State>(empty);
  const ids = order.filter((id) => state.ids.has(id));
  const clear = React.useCallback(() => setState(empty), []);

  return {
    /** Selected cell ids in document order. */
    ids,
    has: (id: string) => state.ids.has(id),
    select: (id: string, mode: Mode) =>
      setState((previous) => click(previous, order, id, mode)),
    extend: (from: string, to: string) =>
      setState((previous) => extend(previous, order, from, to)),
    selectAll: () => setState((previous) => all(previous, order)),
    clear,
  };
}
