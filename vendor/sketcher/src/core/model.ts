// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/core/model.ts. Edit it there and rerun scripts/sketcher.ts.
import { type Point, type Rect, boundsOf, union } from "./geometry";

export type StrokeTool = "pen" | "marker";
export type Background = "plain" | "dots" | "grid";
export const BACKGROUNDS: readonly Background[] = ["plain", "dots", "grid"];

/** A simple RGBA color with components in 0–1. */
export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a });

/** A committed stroke in canvas coordinates. Treated as immutable. */
export interface Stroke {
  id: string;
  tool: StrokeTool;
  /** Color as drawn. For palette strokes this is only a fallback; see `swatch`. */
  color: RGBA;
  /** Palette slot, so the stroke follows the light/dark palette. `null` = shown exactly as `color`. */
  swatch: number | null;
  /** Line width in canvas units. */
  width: number;
  points: Point[];
}

/** A typeset LaTeX expression on the math layer. */
export interface MathItem {
  id: string;
  latex: string;
  /** Top-left corner in canvas coordinates. */
  origin: Point;
  /** Font size in canvas units. */
  fontSize: number;
  /** Typeset size in canvas units. */
  size: { w: number; h: number };
  color: RGBA;
  swatch: number | null;
  /** The handwriting this item was converted from. */
  ink: Stroke[];
}

/**
 * Something the host renders on the board, such as a notebook cell's output.
 *
 * The board owns the frame (where it sits, how big it is, the ink it was made from); the host
 * owns what goes inside, found through `ref`. On screen the frame is `size` times `scale`, so
 * resizing zooms the content rather than reflowing it.
 */
export interface EmbedItem {
  id: string;
  /** The host's name for the content, e.g. a cell name. */
  ref: string;
  /** Shown in the card's header. */
  title: string;
  /** Top-left corner in canvas coordinates. */
  origin: Point;
  /** Size in canvas units at scale 1, header included. */
  size: { w: number; h: number };
  scale: number;
  /** The handwriting this item was made from, restored by Revert to Ink. */
  ink: Stroke[];
  /** Host data, stored with the board and otherwise left alone. */
  data: Record<string, unknown> | null;
}

/**
 * A connection from one embed to another, drawn as a wire between their cards. The board only
 * knows its two ends; what flows along it (and any code that makes it work) is the host's, in
 * `data`.
 */
export interface LinkItem {
  id: string;
  /** The embed it comes from. */
  from: string;
  /** The embed it goes into. */
  to: string;
  /** What flows along it, shown on the wire (e.g. a variable name). */
  label: string;
  /** Host data, stored with the board and otherwise left alone. */
  data: Record<string, unknown> | null;
}

/** Height of an embed card's header, in canvas units at scale 1. */
export const EMBED_HEADER = 24;

/** The document: a math layer (drawn first), embedded items, and an ink layer on top. */
export interface Drawing {
  version: number;
  strokes: Stroke[];
  math: MathItem[];
  embeds: EmbedItem[];
  /** Links between embeds. Removing either end removes the link. */
  links: LinkItem[];
  background: Background;
}

/** A piece of a drawing, used for copy/paste. */
export interface Fragment {
  strokes: Stroke[];
  math: MathItem[];
  embeds: EmbedItem[];
  /** Links whose two ends are both in the fragment. */
  links?: LinkItem[];
}

export const CURRENT_VERSION = 2;
export const MARKER_ALPHA = 0.35;

export const newID = (): string => crypto.randomUUID().toUpperCase();

export function emptyDrawing(background: Background = "dots"): Drawing {
  return { version: CURRENT_VERSION, strokes: [], math: [], embeds: [], links: [], background };
}

/** Bounding box of the points, outset by half the line width (+1). */
export function strokeBounds(s: Stroke): Rect | null {
  const b = boundsOf(s.points);
  if (!b) return null;
  const pad = s.width / 2 + 1;
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}

export function mathBounds(m: MathItem): Rect {
  return { x: m.origin.x, y: m.origin.y, w: m.size.w, h: m.size.h };
}

export function embedBounds(e: EmbedItem): Rect {
  return { x: e.origin.x, y: e.origin.y, w: e.size.w * e.scale, h: e.size.h * e.scale };
}

export function contentBounds(
  d: { strokes: readonly Stroke[]; math: readonly MathItem[]; embeds?: readonly EmbedItem[] },
): Rect | null {
  let r: Rect | null = null;
  for (const s of d.strokes) r = union(r, strokeBounds(s));
  for (const m of d.math) r = union(r, mathBounds(m));
  for (const e of d.embeds ?? []) r = union(r, embedBounds(e));
  return r;
}

export const isEmpty = (d: Drawing) => d.strokes.length === 0 && d.math.length === 0 && d.embeds.length === 0;
