/**
 * The wires the board shows between cards, from marimo's dataflow: which card's cell reads which
 * other card's globals, directly or through cells without a card (a connection's helpers, say).
 *
 * @module
 */
import type { Wire } from "sketcher";

/** A cell, as far as the dataflow goes. */
export interface FlowCell {
  readonly name: string;
  readonly defs: readonly string[];
  readonly refs: readonly string[];
}

/**
 * One wire per pair of cards whose cells depend on each other, from the card whose cell defines
 * a name to the one that reads it. A path through up to `depth` cells without a card counts too,
 * and its label says so: `amplitude via samples`.
 */
export function dataflow(
  cells: readonly FlowCell[],
  cards: ReadonlySet<string>,
  depth = 3,
): Wire[] {
  const wires: Wire[] = [];
  for (const source of cells) {
    if (!cards.has(source.name) || source.defs.length === 0) continue;
    const seen = new Set([source.name]);
    // Breadth first, so the shortest path to each card is the one that labels its wire.
    let frontier: { cell: FlowCell; vars: string[]; via: string[] }[] = [
      { cell: source, vars: [], via: [] },
    ];
    for (let hop = 0; hop <= depth && frontier.length > 0; hop++) {
      const next: typeof frontier = [];
      for (const { cell, vars, via } of frontier) {
        for (const reader of cells) {
          if (seen.has(reader.name)) continue;
          const read = cell.defs.filter((d) => reader.refs.includes(d));
          if (read.length === 0) continue;
          seen.add(reader.name);
          const used = via.length === 0 ? read : vars;
          if (cards.has(reader.name)) {
            wires.push({
              from: source.name,
              to: reader.name,
              label: `${used.join(", ")}${via.length > 0 ? ` via ${via.join(", ")}` : ""}`,
            });
          } else {
            next.push({ cell: reader, vars: used, via: [...via, reader.name] });
          }
        }
      }
      frontier = next;
    }
  }
  return wires;
}
