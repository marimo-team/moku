/**
 * Keeps the board's cards and the notebook's cells in step.
 *
 * A card names its cell by `ref` (the cell name, which survives reloads; cell IDs do not) and
 * carries the code it was made with in `data.code`, so the board can always bring a cell back.
 * Every ask gives the card a new `data.askId`. The rule is simple: when a card appears or its
 * `askId` changes, the board's code wins and the cell is written and run; otherwise the cell
 * wins, and edits made elsewhere flow back into `data.code`.
 *
 * Undo and redo fall out of that. Undoing an Ask removes the card, which deletes the cell; redo
 * brings the card back, which recreates it. Undoing a refine restores the previous `askId`
 * and code, which rewrites the cell.
 *
 * A link between two cards can bring helper cells along (simulation code between a slider and
 * a histogram, say), kept in its `data.helpers`. They have no card: the board is a view, and
 * shows only the cells it chooses to. Each helper is an {@link Owner} like a card is, so the same
 * rule covers them: connecting creates them, re-asking rewrites them, and removing the link (or
 * undoing the connection) deletes them.
 *
 * @module
 */
import { Predicate } from "effect";
import type { EmbedItem, LinkItem } from "sketcher";

/** What the board needs to know about a cell. */
export interface CellInfo {
  readonly id: string;
  /** Null when the host withholds source. */
  readonly code: string | null;
}

/** A change to make to the notebook, by cell name. */
type Op =
  | { readonly kind: "create"; readonly name: string; readonly code: string }
  | { readonly kind: "update"; readonly name: string; readonly code: string }
  | { readonly kind: "delete"; readonly name: string };

export interface Plan {
  /** Notebook edits, in order. */
  readonly ops: readonly Op[];
  /** Cells to run once the edits are confirmed. */
  readonly run: readonly string[];
  /** Owners that must point at a new cell name (a pasted copy, say). */
  readonly renames: readonly { readonly id: string; readonly ref: string }[];
}

export const codeOf = (item: EmbedItem): string | null =>
  Predicate.isString(item.data?.code) ? item.data.code : null;

/** A cell a link brought along. */
export interface Helper {
  readonly name: string;
  readonly code: string;
}

/** The helper cells a link keeps in its data. */
export function helpersOf(link: LinkItem): Helper[] {
  const helpers = link.data?.helpers;
  if (!Array.isArray(helpers)) return [];
  return helpers.filter(
    (h): h is Helper =>
      Predicate.isObject(h) &&
      Predicate.hasProperty(h, "name") &&
      Predicate.isString(h.name) &&
      Predicate.hasProperty(h, "code") &&
      Predicate.isString(h.code),
  );
}

/** Something on the board that owns a cell: a card, or a helper a link brought along. */
export interface Owner {
  /** The card's ID, or `<link ID>/<helper name>`. */
  readonly id: string;
  /** The cell's name. */
  readonly ref: string;
  readonly code: string | null;
  readonly askId: unknown;
}

/** Separates a link's ID from a helper's name in a helper's {@link Owner.id}. */
const HELPER = "/";

/** The link and helper an owner ID names, or null for a card. */
export function helperOf(id: string): { link: string; name: string } | null {
  const at = id.indexOf(HELPER);
  return at < 0 ? null : { link: id.slice(0, at), name: id.slice(at + 1) };
}

/** Everything on the board that owns a cell. */
export function ownersOf(
  embeds: readonly EmbedItem[],
  links: readonly LinkItem[] = [],
): Owner[] {
  return [
    ...embeds.map((e) => ({
      id: e.id,
      ref: e.ref,
      code: codeOf(e),
      askId: e.data?.askId,
    })),
    ...links.flatMap((l) =>
      helpersOf(l).map((h) => ({
        id: `${l.id}${HELPER}${h.name}`,
        ref: h.name,
        code: h.code,
        askId: l.data?.askId,
      })),
    ),
  ];
}

/**
 * The notebook edits that follow from the board's owners changing from `prev` to `next` (see
 * {@link ownersOf}).
 *
 * `taken` says whether a name is in use outside the board (other cells, the board cell).
 */
export function reconcile(
  prev: readonly Owner[],
  next: readonly Owner[],
  cells: ReadonlyMap<string, CellInfo>,
  taken: (name: string) => boolean = () => false,
): Plan {
  const before = new Map(prev.map((e) => [e.id, e]));
  const ops: Op[] = [];
  const run: string[] = [];
  const renames: { id: string; ref: string }[] = [];
  const claimed = new Set<string>();
  const used = new Set(next.map((e) => e.ref));

  const write = (name: string, code: string | null, exists: boolean) => {
    if (code === null) return;
    ops.push(exists ? { kind: "update", name, code } : { kind: "create", name, code });
    run.push(name);
  };

  for (const item of next) {
    const was = before.get(item.id);
    const { code } = item;
    let name = item.ref;
    if (!was && claimed.has(name)) {
      // A second card for one cell (a paste): give the copy a cell of its own.
      name = freshName(
        name,
        (n) => cells.has(n) || used.has(n) || claimed.has(n) || taken(n),
      );
      renames.push({ id: item.id, ref: name });
      used.add(name);
    }
    claimed.add(name);
    const cell = cells.get(name);
    if (!was || was.ref !== name) {
      if (!cell) write(name, code, false);
      else if (cell.code !== null && code !== null && cell.code !== code)
        write(name, code, true);
    } else if (was.askId !== item.askId) {
      write(name, code, !!cell);
    }
  }

  // Cells whose last owner is gone go with it.
  for (const item of prev) {
    if (
      !claimed.has(item.ref) &&
      cells.has(item.ref) &&
      !ops.some((op) => op.name === item.ref)
    ) {
      ops.push({ kind: "delete", name: item.ref });
      claimed.add(item.ref);
    }
  }
  return { ops, run, renames };
}

/** Owners whose cell was edited elsewhere, with the cell's current code. */
export function staleCode(
  items: readonly Owner[],
  cells: ReadonlyMap<string, CellInfo>,
): { readonly id: string; readonly code: string }[] {
  const out: { id: string; code: string }[] = [];
  for (const item of items) {
    const cell = cells.get(item.ref);
    if (cell && cell.code !== null && cell.code !== item.code)
      out.push({ id: item.id, code: cell.code });
  }
  return out;
}

/** `base`, or `base_2`, `base_3`, … whichever is free first. */
export function freshName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  const stem = base.replace(/_\d+$/, "");
  for (let n = 2; ; n++) {
    const name = `${stem}_${n}`;
    if (!taken(name)) return name;
  }
}
