// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/render/background.ts. Edit it there and rerun scripts/sketcher.ts.
import type { Background } from "../core/model";
import { type Theme, css } from "../core/theme";
import type { Viewport } from "../core/viewport";

/** Dots or grid lines, drawn in view coordinates (constant on-screen size). */
export function drawBackground(
  ctx: CanvasRenderingContext2D, background: Background, viewport: Viewport, theme: Theme,
  size: { w: number; h: number },
): void {
  if (background === "plain") return;
  let step = 24;
  while (step * viewport.scale < 12) step *= 2;
  const topLeft = viewport.toCanvas({ x: 0, y: 0 });
  const bottomRight = viewport.toCanvas({ x: size.w, y: size.h });
  const startX = Math.floor(topLeft.x / step) * step;
  const startY = Math.floor(topLeft.y / step) * step;

  ctx.save();
  if (background === "dots") {
    const r = 1.1;
    ctx.beginPath();
    for (let y = startY; y <= bottomRight.y + step; y += step) {
      for (let x = startX; x <= bottomRight.x + step; x += step) {
        const p = viewport.toView({ x, y });
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = css(theme.patternColor);
    ctx.fill();
  } else {
    ctx.beginPath();
    for (let x = startX; x <= bottomRight.x + step; x += step) {
      const vx = Math.round(viewport.toView({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(vx, 0);
      ctx.lineTo(vx, size.h);
    }
    for (let y = startY; y <= bottomRight.y + step; y += step) {
      const vy = Math.round(viewport.toView({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, vy);
      ctx.lineTo(size.w, vy);
    }
    ctx.strokeStyle = css(theme.gridLineColor);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}
