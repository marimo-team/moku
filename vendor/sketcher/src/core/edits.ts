// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/core/edits.ts. Edit it there and rerun scripts/sketcher.ts.
// Editing operations on a drawing. Strokes, math items, embeds and links share one ID space. All
// are pure. A link goes wherever its two embeds go: removing either end removes it.
import { type Point, type Rect, contains, outset, union } from "./geometry";
import {
  type Drawing, type EmbedItem, type Fragment, type LinkItem, type MathItem, type Stroke, embedBounds, mathBounds, newID, strokeBounds,
} from "./model";

export interface Vector {
  dx: number;
  dy: number;
}

export function translateStroke(s: Stroke, d: Vector): Stroke {
  return { ...s, points: s.points.map((p) => ({ x: p.x + d.dx, y: p.y + d.dy })) };
}

const scalePoint = (p: Point, f: number, a: Point): Point => ({ x: a.x + (p.x - a.x) * f, y: a.y + (p.y - a.y) * f });

/** Scales points and line width about `anchor`. */
export function scaleStroke(s: Stroke, f: number, anchor: Point): Stroke {
  return { ...s, points: s.points.map((p) => scalePoint(p, f, anchor)), width: s.width * f };
}

export function translateMath(m: MathItem, d: Vector): MathItem {
  return { ...m, origin: { x: m.origin.x + d.dx, y: m.origin.y + d.dy }, ink: m.ink.map((s) => translateStroke(s, d)) };
}

/** Scales position, size and font size about `anchor` (and the hidden ink with it). */
export function scaleMath(m: MathItem, f: number, anchor: Point): MathItem {
  return {
    ...m,
    origin: scalePoint(m.origin, f, anchor),
    size: { w: m.size.w * f, h: m.size.h * f },
    fontSize: m.fontSize * f,
    ink: m.ink.map((s) => scaleStroke(s, f, anchor)),
  };
}

export function translateEmbed(e: EmbedItem, d: Vector): EmbedItem {
  return { ...e, origin: { x: e.origin.x + d.dx, y: e.origin.y + d.dy }, ink: e.ink.map((s) => translateStroke(s, d)) };
}

/** Scales an embed about `anchor`: its frame moves and zooms, its content keeps its layout size. */
export function scaleEmbed(e: EmbedItem, f: number, anchor: Point): EmbedItem {
  return { ...e, origin: scalePoint(e.origin, f, anchor), scale: e.scale * f, ink: e.ink.map((s) => scaleStroke(s, f, anchor)) };
}

export function allIDs(d: Drawing): Set<string> {
  return new Set([...d.strokes.map((s) => s.id), ...d.math.map((m) => m.id), ...d.embeds.map((e) => e.id)]);
}

/** Union of the bounds of the items with these IDs. */
export function boundsOfIDs(d: Drawing, ids: ReadonlySet<string>): Rect | null {
  let r: Rect | null = null;
  for (const s of d.strokes) if (ids.has(s.id)) r = union(r, strokeBounds(s));
  for (const m of d.math) if (ids.has(m.id)) r = union(r, mathBounds(m));
  for (const e of d.embeds) if (ids.has(e.id)) r = union(r, embedBounds(e));
  return r;
}

export function translating(d: Drawing, ids: ReadonlySet<string>, v: Vector): Drawing {
  return {
    ...d,
    strokes: d.strokes.map((s) => (ids.has(s.id) ? translateStroke(s, v) : s)),
    math: d.math.map((m) => (ids.has(m.id) ? translateMath(m, v) : m)),
    embeds: d.embeds.map((e) => (ids.has(e.id) ? translateEmbed(e, v) : e)),
  };
}

/** Uniformly scales the items with these IDs about `anchor`. */
export function scaling(d: Drawing, ids: ReadonlySet<string>, f: number, anchor: Point): Drawing {
  return {
    ...d,
    strokes: d.strokes.map((s) => (ids.has(s.id) ? scaleStroke(s, f, anchor) : s)),
    math: d.math.map((m) => (ids.has(m.id) ? scaleMath(m, f, anchor) : m)),
    embeds: d.embeds.map((e) => (ids.has(e.id) ? scaleEmbed(e, f, anchor) : e)),
  };
}

/** Drops links that lost an end. */
function pruned(d: Drawing): Drawing {
  const ids = new Set(d.embeds.map((e) => e.id));
  const links = d.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  return links.length === d.links.length ? d : { ...d, links };
}

export function removing(d: Drawing, ids: ReadonlySet<string>): Drawing {
  return pruned({
    ...d,
    strokes: d.strokes.filter((s) => !ids.has(s.id)),
    math: d.math.filter((m) => !ids.has(m.id)),
    embeds: d.embeds.filter((e) => !ids.has(e.id)),
    links: d.links.filter((l) => !ids.has(l.id)),
  });
}

/** The items with these IDs, and the links between embeds among them. */
export function fragment(d: Drawing, ids: ReadonlySet<string>): Fragment {
  const embeds = d.embeds.filter((e) => ids.has(e.id));
  const links = d.links.filter((l) => ids.has(l.from) && ids.has(l.to));
  return {
    strokes: d.strokes.filter((s) => ids.has(s.id)),
    math: d.math.filter((m) => ids.has(m.id)),
    embeds,
    ...(links.length > 0 ? { links } : {}),
  };
}

/** Adds a copy of `fragment` (with fresh IDs) moved by `offset`. Returns the new drawing and IDs. */
export function inserting(d: Drawing, f: Fragment, offset: Vector): { drawing: Drawing; ids: Set<string> } {
  const ids = new Set<string>();
  const strokes = f.strokes.map((s) => {
    const copy = { ...translateStroke(s, offset), id: newID() };
    ids.add(copy.id);
    return copy;
  });
  const math = f.math.map((m) => {
    const moved = translateMath(m, offset);
    const copy = { ...moved, id: newID(), ink: moved.ink.map((s) => ({ ...s, id: newID() })) };
    ids.add(copy.id);
    return copy;
  });
  const fresh = new Map<string, string>();
  const embeds = f.embeds.map((e) => {
    const moved = translateEmbed(e, offset);
    const copy = { ...moved, id: newID(), ink: moved.ink.map((s) => ({ ...s, id: newID() })) };
    fresh.set(e.id, copy.id);
    ids.add(copy.id);
    return copy;
  });
  // Links between pasted cards connect the copies.
  const links = (f.links ?? []).flatMap((l) => {
    const from = fresh.get(l.from), to = fresh.get(l.to);
    return from && to ? [{ ...l, id: newID(), from, to }] : [];
  });
  return {
    drawing: {
      ...d, strokes: [...d.strokes, ...strokes], math: [...d.math, ...math], embeds: [...d.embeds, ...embeds],
      links: [...d.links, ...links],
    },
    ids,
  };
}

/** Replaces the strokes with a math item that keeps them as its `ink`. Null if none of them exist. */
export function converting(
  d: Drawing, strokeIDs: ReadonlySet<string>, latex: string, fontSize: number, frame: Rect,
): { drawing: Drawing; id: string } | null {
  const source = d.strokes.filter((s) => strokeIDs.has(s.id));
  if (source.length === 0) return null;
  // Take the most used palette slot, preferring pen strokes over highlighter. Ties go to the lower slot.
  const pens = source.filter((s) => s.tool === "pen");
  const colored = pens.length > 0 ? pens : source;
  const counts = new Map<number, number>();
  for (const s of colored) counts.set(s.swatch ?? -1, (counts.get(s.swatch ?? -1) ?? 0) + 1);
  let slot = 0, best = -1;
  for (const [key, n] of counts) {
    if (n > best || (n === best && key < slot)) {
      slot = key;
      best = n;
    }
  }
  const color = (colored.find((s) => (s.swatch ?? -1) === slot) ?? colored[0]).color;
  const item: MathItem = {
    id: newID(), latex, origin: { x: frame.x, y: frame.y }, fontSize, size: { w: frame.w, h: frame.h },
    color, swatch: slot >= 0 ? slot : null, ink: source,
  };
  return {
    drawing: { ...d, strokes: d.strokes.filter((s) => !strokeIDs.has(s.id)), math: [...d.math, item] },
    id: item.id,
  };
}

/** Puts a converted item's handwriting back on the ink layer. Returns the restored stroke IDs. */
export function revertingToInk(d: Drawing, mathID: string): { drawing: Drawing; ids: Set<string> } | null {
  const item = d.math.find((m) => m.id === mathID);
  if (!item || item.ink.length === 0) return null;
  return {
    drawing: { ...d, math: d.math.filter((m) => m.id !== mathID), strokes: [...d.strokes, ...item.ink] },
    ids: new Set(item.ink.map((s) => s.id)),
  };
}

/** Changes an item's LaTeX, keeping its font size and top-left corner. */
export function editingLatex(d: Drawing, mathID: string, latex: string, size: { w: number; h: number }): Drawing {
  return { ...d, math: d.math.map((m) => (m.id === mathID ? { ...m, latex, size } : m)) };
}

/** What an embed shows and how it's labelled; everything but its place and ink. */
export type EmbedContent = Pick<EmbedItem, "ref" | "title" | "data">;

/** Replaces the strokes (any of them may be gone) with an embed that keeps them as its `ink`. */
export function embedding(
  d: Drawing, strokeIDs: ReadonlySet<string>, origin: Point, size: { w: number; h: number }, content: EmbedContent,
): { drawing: Drawing; id: string } {
  const item: EmbedItem = {
    id: newID(), ...content, origin, size, scale: 1, ink: d.strokes.filter((s) => strokeIDs.has(s.id)),
  };
  return {
    drawing: { ...d, strokes: d.strokes.filter((s) => !strokeIDs.has(s.id)), embeds: [...d.embeds, item] },
    id: item.id,
  };
}

/** An arrow drawn between the selection and an embed outside it; `null` stands for the selection. */
export interface ArrowLink {
  from: EmbedItem | null;
  to: EmbedItem | null;
}

/**
 * The arrows drawn (as unselected strokes) between the selection and the embeds around it. A
 * stroke counts when one end is at the selection and the other at an embed. It points where its
 * head is (a small stroke at one end), or else the way it was drawn.
 */
export function arrowLinks(d: Drawing, selected: ReadonlySet<string>): ArrowLink[] {
  const NEAR = 32;
  const bounds = boundsOfIDs(d, selected);
  if (!bounds) return [];
  const around = outset(bounds, NEAR);
  const others = d.embeds.filter((e) => !selected.has(e.id));
  const at = (p: Point): EmbedItem | null | undefined => {
    const card = others.find((e) => contains(outset(embedBounds(e), NEAR), p));
    if (card && !contains(bounds, p)) return card;
    return contains(around, p) ? null : undefined;
  };
  const free = d.strokes.filter((s) => !selected.has(s.id) && s.points.length >= 2);
  const heads = free.filter((s) => {
    const r = strokeBounds(s);
    return r !== null && Math.max(r.w, r.h) <= 60;
  });
  const headAt = (p: Point, shaft: Stroke) =>
    heads.some((h) => h !== shaft && contains(outset(strokeBounds(h)!, NEAR / 2), p));
  const links: ArrowLink[] = [];
  for (const s of free) {
    const a = s.points[0], b = s.points[s.points.length - 1];
    const ea = at(a), eb = at(b);
    if (ea === undefined || eb === undefined || ea === eb) continue;
    if (ea !== null && eb !== null) continue;
    const reversed = headAt(a, s) && !headAt(b, s);
    const link = reversed ? { from: eb, to: ea } : { from: ea, to: eb };
    if (!links.some((l) => l.from === link.from && l.to === link.to)) links.push(link);
  }
  return links;
}

/** Changes an embed, and folds the strokes (notes drawn on it, say) into its `ink`. */
export function refiningEmbed(
  d: Drawing, id: string, strokeIDs: ReadonlySet<string>, patch: Partial<EmbedContent>,
): Drawing {
  const absorbed = d.strokes.filter((s) => strokeIDs.has(s.id));
  return {
    ...d,
    strokes: d.strokes.filter((s) => !strokeIDs.has(s.id)),
    embeds: d.embeds.map((e) => (e.id === id ? { ...e, ...patch, ink: [...e.ink, ...absorbed] } : e)),
  };
}

/** Changes an embed's content or frame. */
export function updatingEmbed(d: Drawing, id: string, patch: Partial<Omit<EmbedItem, "id">>): Drawing {
  return { ...d, embeds: d.embeds.map((e) => (e.id === id ? { ...e, ...patch } : e)) };
}

/** Removes an embed and puts the handwriting it was made from back. Returns the restored stroke IDs. */
export function revertingEmbedToInk(d: Drawing, id: string): { drawing: Drawing; ids: Set<string> } | null {
  const item = d.embeds.find((e) => e.id === id);
  if (!item || item.ink.length === 0) return null;
  return {
    drawing: pruned({ ...d, embeds: d.embeds.filter((e) => e.id !== id), strokes: [...d.strokes, ...item.ink] }),
    ids: new Set(item.ink.map((s) => s.id)),
  };
}

/** Adds a link from one embed to another. Null if either is missing or they're the same. */
export function linking(
  d: Drawing, from: string, to: string, content: Pick<LinkItem, "label" | "data">,
): { drawing: Drawing; id: string } | null {
  if (from === to || !d.embeds.some((e) => e.id === from) || !d.embeds.some((e) => e.id === to)) return null;
  const link: LinkItem = { id: newID(), from, to, ...content };
  return { drawing: { ...d, links: [...d.links, link] }, id: link.id };
}

/** Changes a link's label or host data. */
export function updatingLink(d: Drawing, id: string, patch: Partial<Pick<LinkItem, "label" | "data">>): Drawing {
  return { ...d, links: d.links.map((l) => (l.id === id ? { ...l, ...patch } : l)) };
}
