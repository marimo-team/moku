/**
 * Compute document orders for moving cells and choosing focus after deleting them.
 *
 * @module
 */

/**
 * Moves the chosen cells one place up or down, keeping their relative order.
 *
 * Cells are visited in the direction of travel, so a block of adjacent cells
 * moves as a unit. A block at the start or end stays there while the others
 * move. Returns `order` itself when nothing can move.
 */
export function move(
  order: readonly string[],
  ids: ReadonlySet<string>,
  direction: "up" | "down",
): readonly string[] {
  const next = [...order];
  const step = direction === "up" ? -1 : 1;
  const indices = next.map((_, index) => index);
  if (direction === "down") indices.reverse();
  let changed = false;
  for (const index of indices) {
    const neighbor = index + step;
    if (!ids.has(next[index]) || neighbor < 0 || neighbor >= next.length) continue;
    if (ids.has(next[neighbor])) continue;
    [next[index], next[neighbor]] = [next[neighbor], next[index]];
    changed = true;
  }
  return changed ? next : order;
}

/**
 * Returns the cell that should take focus after deleting `ids`.
 *
 * That is the first remaining cell after the last deleted one, or the last
 * remaining cell before them when the deletion reaches the end. Returns
 * undefined when no cell remains.
 */
export function focusAfterDelete(
  order: readonly string[],
  ids: ReadonlySet<string>,
): string | undefined {
  const last = order.findLastIndex((id) => ids.has(id));
  const after = order.slice(last + 1).find((id) => !ids.has(id));
  return after ?? order.findLast((id) => !ids.has(id));
}
