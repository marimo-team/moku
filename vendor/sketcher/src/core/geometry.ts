// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/core/geometry.ts. Edit it there and rerun scripts/sketcher.ts.
/** Canvas coordinates are y-down everywhere. */
export interface Point {
  x: number;
  y: number;
}

/** An axis-aligned rectangle. Functions that may have no result return `null` (CGRect.null). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const pt = (x: number, y: number): Point => ({ x, y });

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Bounding box of points, or null when empty. */
export function boundsOf(points: readonly Point[]): Rect | null {
  if (points.length === 0) return null;
  let minX = points[0].x, minY = points[0].y, maxX = minX, maxY = minY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function union(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Grows the rect by `d` on every side (negative shrinks). */
export function outset(r: Rect, d: number): Rect {
  return { x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function contains(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
}

export const midX = (r: Rect) => r.x + r.w / 2;
export const midY = (r: Rect) => r.y + r.h / 2;
export const center = (r: Rect): Point => ({ x: midX(r), y: midY(r) });

/** Smallest rect with integer edges containing `r` (CGRect.integral). */
export function integral(r: Rect): Rect {
  const x = Math.floor(r.x), y = Math.floor(r.y);
  return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

export const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
