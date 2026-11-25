// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/core/codec.ts. Edit it there and rerun scripts/sketcher.ts.
// Reads and writes the `.sketcher` JSON format of the Mac app (Swift Codable):
// points and sizes are `[x, y]` arrays, `swatch` is omitted when nil, keys are sorted.
// Embedded items and the links between them are web-only: they're written only when there are
// some, so boards without them stay byte-for-byte what the Mac app writes (which reads past them
// and drops them).
import type { Point } from "./geometry";
import {
  BACKGROUNDS, CURRENT_VERSION, type Background, type Drawing, type EmbedItem, type Fragment, type LinkItem, type MathItem, type RGBA,
  type Stroke,
} from "./model";

export class FormatError extends Error {}

type Json = unknown;

function fail(what: string): never {
  throw new FormatError(`Not a Sketcher board: bad ${what}`);
}

function num(v: Json, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(what);
  return v;
}

function obj(v: Json, what: string): Record<string, Json> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(what);
  return v as Record<string, Json>;
}

function arr(v: Json, what: string): Json[] {
  if (!Array.isArray(v)) fail(what);
  return v;
}

function pair(v: Json, what: string): [number, number] {
  const a = arr(v, what);
  if (a.length !== 2) fail(what);
  return [num(a[0], what), num(a[1], what)];
}

function decodeColor(v: Json): RGBA {
  const o = obj(v, "color");
  return { r: num(o.r, "color"), g: num(o.g, "color"), b: num(o.b, "color"), a: num(o.a, "color") };
}

function decodeSwatch(v: Json): number | null {
  return v === undefined || v === null ? null : num(v, "swatch");
}

function decodeID(v: Json): string {
  if (typeof v !== "string") fail("id");
  return v.toUpperCase();
}

export function decodeStroke(v: Json): Stroke {
  const o = obj(v, "stroke");
  if (o.tool !== "pen" && o.tool !== "marker") fail("tool");
  return {
    id: decodeID(o.id),
    tool: o.tool,
    color: decodeColor(o.color),
    swatch: decodeSwatch(o.swatch),
    width: num(o.width, "width"),
    points: arr(o.points, "points").map((p): Point => {
      const [x, y] = pair(p, "point");
      return { x, y };
    }),
  };
}

export function decodeMathItem(v: Json): MathItem {
  const o = obj(v, "math item");
  if (typeof o.latex !== "string") fail("latex");
  const [x, y] = pair(o.origin, "origin");
  const [w, h] = pair(o.size, "size");
  return {
    id: decodeID(o.id),
    latex: o.latex,
    origin: { x, y },
    fontSize: num(o.fontSize, "fontSize"),
    size: { w, h },
    color: decodeColor(o.color),
    swatch: decodeSwatch(o.swatch),
    ink: arr(o.ink, "ink").map(decodeStroke),
  };
}

export function decodeEmbedItem(v: Json): EmbedItem {
  const o = obj(v, "embed");
  if (typeof o.ref !== "string") fail("ref");
  const [x, y] = pair(o.origin, "origin");
  const [w, h] = pair(o.size, "size");
  const scale = o.scale === undefined ? 1 : num(o.scale, "scale");
  if (!(w > 0 && h > 0 && scale > 0)) fail("size");
  return {
    id: decodeID(o.id),
    ref: o.ref,
    title: typeof o.title === "string" ? o.title : "",
    origin: { x, y },
    size: { w, h },
    scale,
    ink: arr(o.ink ?? [], "ink").map(decodeStroke),
    data: o.data === undefined || o.data === null ? null : obj(o.data, "data"),
  };
}

export function decodeLinkItem(v: Json): LinkItem {
  const o = obj(v, "link");
  return {
    id: decodeID(o.id),
    from: decodeID(o.from),
    to: decodeID(o.to),
    label: typeof o.label === "string" ? o.label : "",
    data: o.data === undefined || o.data === null ? null : obj(o.data, "data"),
  };
}

/** Links whose ends are both among `embeds` (others are left over from a lost card). */
function keepLinks(links: LinkItem[], embeds: readonly EmbedItem[]): LinkItem[] {
  const ids = new Set(embeds.map((e) => e.id));
  return links.filter((l) => l.from !== l.to && ids.has(l.from) && ids.has(l.to));
}

const list = <T>(v: Json, what: string, decode: (v: Json) => T): T[] =>
  v === undefined || v === null ? [] : arr(v, what).map(decode);

/** Decodes a board. Version 1 boards (no math layer) are upgraded. */
export function decodeDrawing(v: Json): Drawing {
  const o = obj(v, "board");
  num(o.version, "version");
  if (!BACKGROUNDS.includes(o.background as Background)) fail("background");
  const embeds = list(o.embeds, "embeds", decodeEmbedItem);
  return {
    version: CURRENT_VERSION,
    strokes: arr(o.strokes, "strokes").map(decodeStroke),
    math: list(o.math, "math", decodeMathItem),
    embeds,
    links: keepLinks(list(o.links, "links", decodeLinkItem), embeds),
    background: o.background as Background,
  };
}

export function decodeFragment(v: Json): Fragment {
  const o = obj(v, "fragment");
  const embeds = list(o.embeds, "embeds", decodeEmbedItem);
  const links = keepLinks(list(o.links, "links", decodeLinkItem), embeds);
  return {
    strokes: list(o.strokes, "strokes", decodeStroke),
    math: list(o.math, "math", decodeMathItem),
    embeds,
    ...(links.length > 0 ? { links } : {}),
  };
}

function encodeStroke(s: Stroke): Json {
  const out: Record<string, Json> = {
    color: { ...s.color },
    id: s.id,
    points: s.points.map((p) => [p.x, p.y]),
    tool: s.tool,
    width: s.width,
  };
  if (s.swatch !== null) out.swatch = s.swatch;
  return out;
}

function encodeMathItem(m: MathItem): Json {
  const out: Record<string, Json> = {
    color: { ...m.color },
    fontSize: m.fontSize,
    id: m.id,
    ink: m.ink.map(encodeStroke),
    latex: m.latex,
    origin: [m.origin.x, m.origin.y],
    size: [m.size.w, m.size.h],
  };
  if (m.swatch !== null) out.swatch = m.swatch;
  return out;
}

function encodeEmbedItem(e: EmbedItem): Json {
  const out: Record<string, Json> = {
    id: e.id,
    ink: e.ink.map(encodeStroke),
    origin: [e.origin.x, e.origin.y],
    ref: e.ref,
    scale: e.scale,
    size: [e.size.w, e.size.h],
    title: e.title,
  };
  if (e.data !== null) out.data = e.data;
  return out;
}

function encodeLinkItem(l: LinkItem): Json {
  const out: Record<string, Json> = { from: l.from, id: l.id, label: l.label, to: l.to };
  if (l.data !== null) out.data = l.data;
  return out;
}

/** The board as a plain JSON value (what the widget syncs to Python). */
export function encodeDrawing(d: Drawing): Json {
  const out: Record<string, Json> = {
    background: d.background,
    math: d.math.map(encodeMathItem),
    strokes: d.strokes.map(encodeStroke),
    version: CURRENT_VERSION,
  };
  if (d.embeds.length > 0) out.embeds = d.embeds.map(encodeEmbedItem);
  if (d.links.length > 0) out.links = d.links.map(encodeLinkItem);
  return out;
}

export function encodeFragment(f: Fragment): Json {
  const out: Record<string, Json> = { math: f.math.map(encodeMathItem), strokes: f.strokes.map(encodeStroke) };
  if (f.embeds.length > 0) out.embeds = f.embeds.map(encodeEmbedItem);
  if (f.links && f.links.length > 0) out.links = f.links.map(encodeLinkItem);
  return out;
}

/** JSON.stringify with keys sorted at every level, like Swift's `.sortedKeys`. */
export function stableStringify(v: Json): string {
  return JSON.stringify(v, (_key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map((k) => [k, (value as Record<string, Json>)[k]]));
    }
    return value;
  });
}

/** `.sketcher` file contents. */
export const serializeDrawing = (d: Drawing): string => stableStringify(encodeDrawing(d));

export const parseDrawing = (text: string): Drawing => {
  let json: Json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new FormatError("Not a Sketcher board: invalid JSON");
  }
  return decodeDrawing(json);
};
