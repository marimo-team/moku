// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/render/export.ts. Edit it there and rerun scripts/sketcher.ts.
import { type Rect, integral, outset } from "../core/geometry";
import { type Drawing, contentBounds } from "../core/model";
import { type Theme, css } from "../core/theme";
import { prepareMath } from "../math/mathRenderer";
import { drawLayers } from "./renderer";

/**
 * Renders both layers onto a paper-colored canvas cropped to the content (plus padding). With
 * `highlight`, that rect, or each of those rects (canvas coordinates), gets a dashed outline, e.g.
 * to show what's selected.
 */
export function renderImage(
  drawing: Drawing, theme: Theme, scale = 2, padding = 32, highlight: Rect | readonly Rect[] | null = null,
): HTMLCanvasElement | null {
  const content = contentBounds(drawing);
  if (!content) return null;
  const rect = integral(outset(content, padding));
  const width = Math.floor(rect.w * scale), height = Math.floor(rect.h * scale);
  if (width <= 0 || height <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = css(theme.paper);
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(scale, 0, 0, scale, -rect.x * scale, -rect.y * scale);
  drawLayers(ctx, drawing, theme);
  for (const h of highlight === null ? [] : "w" in highlight ? [highlight] : highlight) {
    const r = outset(h, 10);
    ctx.strokeStyle = "#0a84ff";
    ctx.lineWidth = 4 / scale;
    ctx.setLineDash([12 / scale, 8 / scale]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  return canvas;
}

/** Like `renderImage`, after waiting for math images to load. */
export async function renderImageReady(
  drawing: Drawing, theme: Theme, scale = 2, padding = 32, highlight: Rect | readonly Rect[] | null = null,
) {
  await prepareMath(drawing.math, theme);
  return renderImage(drawing, theme, scale, padding, highlight);
}

export async function renderPNG(
  drawing: Drawing, theme: Theme, scale = 2, padding = 32, highlight: Rect | readonly Rect[] | null = null,
): Promise<Blob | null> {
  const canvas = await renderImageReady(drawing, theme, scale, padding, highlight);
  if (!canvas) return Promise.resolve(null);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}
