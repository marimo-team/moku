// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/math/mathRenderer.ts. Edit it there and rerun scripts/sketcher.ts.
// Layout and drawing of math items. Valid LaTeX is drawn from a MathJax SVG; anything else is
// shown as its source text with a red dashed underline until it is fixed.
import type { Rect } from "../core/geometry";
import { type MathItem, type RGBA, mathBounds } from "../core/model";
import { type Theme, css } from "../core/theme";
import { sizedSVG, typeset } from "./typeset";

export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 240;
export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const clampFont = (s: number) => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, s));

/** Typeset size at `fontSize`, or null if the LaTeX doesn't parse. */
export function mathSize(latex: string, fontSize: number): { w: number; h: number } | null {
  const t = typeset(latex);
  return t ? { w: t.w * fontSize, h: t.h * fontSize } : null;
}

let measureCtx: CanvasRenderingContext2D | null = null;

/** Size used for LaTeX that doesn't parse: it is shown as its source text. */
export function fallbackSize(latex: string, fontSize: number): { w: number; h: number } {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  measureCtx.font = `${fontSize}px ${MONO_FONT}`;
  return { w: Math.max(measureCtx.measureText(latex).width, fontSize), h: fontSize * 1.3 };
}

/** The size an item should have for its LaTeX and font size. */
export const layoutSize = (latex: string, fontSize: number) => mathSize(latex, fontSize) ?? fallbackSize(latex, fontSize);

/** Font size and frame so typeset `latex` takes up about the same space as the handwriting in `ink`. */
export function fitMath(latex: string, ink: Rect): { fontSize: number; frame: Rect } {
  const reference = 40;
  const ref = mathSize(latex, reference);
  let fontSize: number;
  if (!ref) {
    // Shown as source text: as wide as the handwriting, never taller than it.
    const refWidth = fallbackSize(latex, reference).w;
    fontSize = clampFont(Math.min((reference * ink.w) / Math.max(refWidth, 1), ink.h / 1.3, 28));
  } else {
    let scale = ink.h / Math.max(ref.h, 1);
    // Very wide handwriting (a long line) should fit by width instead of growing tall.
    if (ref.w * scale > ink.w * 1.6) scale = ink.w / Math.max(ref.w, 1);
    fontSize = clampFont(reference * scale);
  }
  const size = layoutSize(latex, fontSize);
  return { fontSize, frame: { x: ink.x, y: ink.y + ink.h / 2 - size.h / 2, w: size.w, h: size.h } };
}

// MARK: Images

const images = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

/** Calls `fn` whenever a math image finishes loading (so boards can redraw). */
export function onMathImageLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function imageFor(latex: string, color: RGBA): HTMLImageElement | null {
  const t = typeset(latex);
  if (!t) return null;
  const key = `${css(color)}|${latex}`;
  let img = images.get(key);
  if (!img) {
    // A large intrinsic size; the SVG is redrawn as vectors at whatever size it is drawn.
    const base = 100;
    const svg = sizedSVG(t, t.w * base, t.h * base, css(color));
    img = new Image();
    img.decoding = "async";
    img.onload = () => listeners.forEach((fn) => fn());
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    if (images.size > 300) images.clear();
    images.set(key, img);
  }
  return img;
}

/** Resolves once every item's image is ready to draw (for exports). */
export async function prepareMath(items: readonly MathItem[], theme: Theme): Promise<void> {
  await Promise.all(
    items.map((m) => {
      const img = imageFor(m.latex, theme.mathColor(m));
      return img && !img.complete ? img.decode().catch(() => {}) : undefined;
    }),
  );
}

/** Draws a math item into a context in canvas coordinates. */
export function drawMath(ctx: CanvasRenderingContext2D, item: MathItem, theme: Theme): void {
  const b = mathBounds(item);
  if (b.w <= 0 || b.h <= 0) return;
  const color = theme.mathColor(item);
  const t = typeset(item.latex);
  if (t) {
    const img = imageFor(item.latex, color);
    if (!img?.complete || img.naturalWidth === 0) return;
    // Aspect-fit into the frame: left aligned, vertically centered.
    const nw = t.w * item.fontSize, nh = t.h * item.fontSize;
    const fit = Math.min(b.w / nw, b.h / nh);
    const w = nw * fit, h = nh * fit;
    ctx.drawImage(img, b.x, b.y + (b.h - h) / 2, w, h);
    return;
  }
  // Can't typeset: show the source with a red dashed underline.
  const fs = item.fontSize;
  ctx.save();
  ctx.fillStyle = css(color);
  ctx.font = `${fs}px ${MONO_FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(item.latex, b.x, b.y + fs);
  ctx.strokeStyle = "rgb(219, 51, 51)";
  ctx.lineWidth = Math.max(1, fs / 16);
  ctx.setLineDash([fs / 6, fs / 10]);
  ctx.beginPath();
  const y = b.y + 1.18 * fs;
  ctx.moveTo(b.x, y);
  ctx.lineTo(b.x + b.w, y);
  ctx.stroke();
  ctx.restore();
}
