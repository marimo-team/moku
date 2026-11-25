// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/render/renderer.ts. Edit it there and rerun scripts/sketcher.ts.
// Board drawing shared by the live canvas and PNG export. The context is in canvas coordinates.
import { type Rect, union } from "../core/geometry";
import { type Drawing, EMBED_HEADER, type EmbedItem, type RGBA, type Stroke, embedBounds, strokeBounds } from "../core/model";
import { drawMath } from "../math/mathRenderer";
import { smoothPath } from "../core/smoothing";
import { type Theme, css, sameColor } from "../core/theme";
import { type WireCurve, pointOnWire, wireCurve, wireHeading } from "../core/wires";

/** A stroke and its smoothed path, in canvas coordinates. */
export interface Item {
  stroke: Stroke;
  path: Path2D;
}

const pathCache = new WeakMap<Stroke, Path2D>();

/** The smoothed path for a stroke, cached per (immutable) stroke object. */
export function pathFor(stroke: Stroke): Path2D {
  let path = pathCache.get(stroke);
  if (!path) {
    path = smoothPath(stroke.points, new Path2D());
    pathCache.set(stroke, path);
  }
  return path;
}

type Ctx = CanvasRenderingContext2D;

/** Offscreen canvas used to flatten highlight groups; grown as needed and reused. */
let scratch: HTMLCanvasElement | null = null;

function scratchContext(width: number, height: number): Ctx {
  scratch ??= document.createElement("canvas");
  if (scratch.width < width || scratch.height < height) {
    scratch.width = Math.max(scratch.width, width);
    scratch.height = Math.max(scratch.height, height);
  }
  return scratch.getContext("2d")!;
}

/**
 * Draws the ink layer.
 *
 * Highlights go first, underneath all pen ink. Highlights of one color are painted opaque into
 * a scratch canvas and composited once at marker opacity, so overlapping strokes of one color
 * never build up. Different colors are separate groups and still mix where they cross.
 */
export function drawInk(ctx: Ctx, items: readonly Item[], theme: Theme): void {
  const groups: { color: ReturnType<Theme["strokeColor"]>; items: Item[] }[] = [];
  for (const item of items) {
    if (item.stroke.tool !== "marker") continue;
    const color = theme.strokeColor(item.stroke);
    const group = groups.find((g) => sameColor(g.color, color));
    if (group) group.items.push(item);
    else groups.push({ color, items: [item] });
  }
  for (const g of groups) drawHighlights(ctx, g.items, css(g.color), theme);
  for (const item of items) {
    if (item.stroke.tool === "pen") drawStroke(ctx, item.stroke, item.path, theme);
  }
}

function drawHighlights(ctx: Ctx, items: readonly Item[], color: string, theme: Theme): void {
  let bounds: Rect | null = null;
  for (const { stroke } of items) {
    const b = strokeBounds(stroke);
    if (b) bounds = union(bounds, b);
  }
  if (!bounds) return;
  // The group's rectangle in device pixels, clipped to the target.
  const t = ctx.getTransform();
  const x0 = Math.max(0, Math.floor(t.a * bounds.x + t.e));
  const y0 = Math.max(0, Math.floor(t.d * bounds.y + t.f));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(t.a * (bounds.x + bounds.w) + t.e));
  const y1 = Math.min(ctx.canvas.height, Math.ceil(t.d * (bounds.y + bounds.h) + t.f));
  if (x1 <= x0 || y1 <= y0) return;

  const s = scratchContext(ctx.canvas.width, ctx.canvas.height);
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.clearRect(x0, y0, x1 - x0, y1 - y0);
  s.setTransform(t);
  s.strokeStyle = color;
  s.lineCap = "round";
  s.lineJoin = "round";
  for (const { stroke, path } of items) {
    s.lineWidth = stroke.width;
    s.stroke(path);
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = theme.markerAlpha;
  ctx.globalCompositeOperation = theme.markerBlend;
  ctx.drawImage(s.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

/** Strokes one path with the stroke's style. A lone marker stroke is blended on its own. */
export function drawStroke(ctx: Ctx, stroke: Stroke, path: Path2D, theme: Theme): void {
  ctx.save();
  ctx.strokeStyle = css(theme.renderColor(stroke));
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (stroke.tool === "marker") ctx.globalCompositeOperation = theme.markerBlend;
  ctx.stroke(path);
  ctx.restore();
}

/**
 * An embed as a labelled box: images don't capture live content, but they should still show
 * where it is and what it is (so Claude can tell which item a note points at).
 */
export function drawEmbedPlaceholder(ctx: Ctx, item: EmbedItem, theme: Theme): void {
  const r = embedBounds(item);
  const s = item.scale;
  const ink = theme.palette[1];
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 10 * s);
  ctx.fillStyle = css(ink, 0.06);
  ctx.fill();
  ctx.strokeStyle = css(ink, 0.6);
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(r.x, r.y + EMBED_HEADER * s);
  ctx.lineTo(r.x + r.w, r.y + EMBED_HEADER * s);
  ctx.stroke();
  ctx.fillStyle = css(ink);
  ctx.textBaseline = "middle";
  ctx.font = `600 ${13 * s}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(item.title || item.ref, r.x + 10 * s, r.y + (EMBED_HEADER * s) / 2, r.w - 20 * s);
  ctx.font = `500 ${15 * s}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  ctx.textAlign = "center";
  ctx.fillText(`cell: ${item.ref}`, r.x + r.w / 2, r.y + (EMBED_HEADER * s + r.h) / 2, r.w - 20 * s);
  ctx.restore();
}

export interface WireStyle {
  color: RGBA;
  /** Line width in canvas units. */
  width: number;
  /** Dash pattern in canvas units, if dashed. */
  dash?: number[];
  dashOffset?: number;
  /** Shown in a chip halfway along. */
  label?: string;
  /** Canvas units per view point, for the chip's text and padding. */
  px: number;
  paper: RGBA;
}

/** A wire between two cards: the curve, an arrowhead at its end, and an optional label chip. */
export function drawWire(ctx: Ctx, curve: WireCurve, style: WireStyle): void {
  const { color, width, px } = style;
  ctx.save();
  ctx.strokeStyle = css(color);
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.setLineDash(style.dash ?? []);
  ctx.lineDashOffset = style.dashOffset ?? 0;
  ctx.beginPath();
  ctx.moveTo(curve.a.x, curve.a.y);
  ctx.bezierCurveTo(curve.c1.x, curve.c1.y, curve.c2.x, curve.c2.y, curve.b.x, curve.b.y);
  ctx.stroke();
  // Arrowhead.
  const d = wireHeading(curve);
  const size = Math.max(7 * px, width * 3.5);
  const back = { x: curve.b.x - d.x * size, y: curve.b.y - d.y * size };
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(curve.b.x, curve.b.y);
  ctx.lineTo(back.x - d.y * size * 0.55, back.y + d.x * size * 0.55);
  ctx.lineTo(back.x + d.y * size * 0.55, back.y - d.x * size * 0.55);
  ctx.closePath();
  ctx.fillStyle = css(color);
  ctx.fill();
  if (style.label) {
    const mid = pointOnWire(curve, 0.5);
    const text = style.label.length > 48 ? `${style.label.slice(0, 47)}…` : style.label;
    ctx.font = `500 ${11 * px}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    const w = ctx.measureText(text).width + 12 * px, h = 18 * px;
    ctx.beginPath();
    ctx.roundRect(mid.x - w / 2, mid.y - h / 2, w, h, h / 2);
    ctx.fillStyle = css(style.paper);
    ctx.fill();
    ctx.lineWidth = Math.max(px, width * 0.6);
    ctx.strokeStyle = css(color);
    ctx.stroke();
    ctx.fillStyle = css(color);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, mid.x, mid.y + 0.5 * px);
  }
  ctx.restore();
}

/** Every layer: math first, then embeds (as placeholders) and the links between them, ink on top. */
export function drawLayers(ctx: Ctx, drawing: Drawing, theme: Theme): void {
  for (const item of drawing.math) drawMath(ctx, item, theme);
  for (const item of drawing.embeds) drawEmbedPlaceholder(ctx, item, theme);
  const byID = new Map(drawing.embeds.map((e) => [e.id, e]));
  for (const link of drawing.links ?? []) {
    const from = byID.get(link.from), to = byID.get(link.to);
    if (!from || !to) continue;
    drawWire(ctx, wireCurve(embedBounds(from), embedBounds(to)), {
      color: theme.palette[1], width: 2, label: link.label || undefined, px: 1, paper: theme.paper,
    });
  }
  drawInk(ctx, drawing.strokes.map((stroke) => ({ stroke, path: pathFor(stroke) })), theme);
}
