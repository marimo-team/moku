// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/core/viewport.ts. Edit it there and rerun scripts/sketcher.ts.
import { type Point, type Rect, midX, midY } from "./geometry";

/** Maps canvas coordinates to view coordinates: `view = canvas * scale + offset`. Immutable. */
export class Viewport {
  static readonly minScale = 0.1;
  static readonly maxScale = 8;

  readonly offset: Point;
  readonly scale: number;

  constructor(offset: Point = { x: 0, y: 0 }, scale = 1) {
    this.offset = offset;
    this.scale = Viewport.clamp(scale);
  }

  static clamp(s: number): number {
    return Math.min(Viewport.maxScale, Math.max(Viewport.minScale, s));
  }

  toView(p: Point): Point {
    return { x: p.x * this.scale + this.offset.x, y: p.y * this.scale + this.offset.y };
  }

  toCanvas(p: Point): Point {
    return { x: (p.x - this.offset.x) / this.scale, y: (p.y - this.offset.y) / this.scale };
  }

  rectToView(r: Rect): Rect {
    const o = this.toView(r);
    return { x: o.x, y: o.y, w: r.w * this.scale, h: r.h * this.scale };
  }

  rectToCanvas(r: Rect): Rect {
    const o = this.toCanvas(r);
    return { x: o.x, y: o.y, w: r.w / this.scale, h: r.h / this.scale };
  }

  panned(dx: number, dy: number): Viewport {
    return new Viewport({ x: this.offset.x + dx, y: this.offset.y + dy }, this.scale);
  }

  /** Zooms by `factor`, keeping the canvas point under `anchor` (view coords) fixed. */
  zoomed(factor: number, anchor: Point): Viewport {
    return this.zoomedTo(this.scale * factor, anchor);
  }

  zoomedTo(newScale: number, anchor: Point): Viewport {
    const c = this.toCanvas(anchor);
    const s = Viewport.clamp(newScale);
    return new Viewport({ x: anchor.x - c.x * s, y: anchor.y - c.y * s }, s);
  }

  equals(o: Viewport): boolean {
    return this.scale === o.scale && this.offset.x === o.offset.x && this.offset.y === o.offset.y;
  }

  /** A viewport that fits `content` into the view with padding. Never zooms in past 100%. */
  static fitting(content: Rect | null, view: { w: number; h: number }, padding = 40): Viewport {
    if (!content || (content.w <= 0 && content.h <= 0) || view.w <= 2 * padding || view.h <= 2 * padding) {
      return new Viewport();
    }
    const sx = (view.w - 2 * padding) / Math.max(content.w, 1);
    const sy = (view.h - 2 * padding) / Math.max(content.h, 1);
    const s = Viewport.clamp(Math.min(1, sx, sy));
    return new Viewport({ x: view.w / 2 - midX(content) * s, y: view.h / 2 - midY(content) * s }, s);
  }
}
