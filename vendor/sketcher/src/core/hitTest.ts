// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/core/hitTest.ts. Edit it there and rerun scripts/sketcher.ts.
import { type Point, type Rect, boundsOf, center, contains, intersects, outset, rectFromPoints } from "./geometry";
import { EMBED_HEADER, type EmbedItem, type MathItem, type Stroke, embedBounds, mathBounds, strokeBounds } from "./model";

/** Shortest distance from `p` to the segment `a`–`b`. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x, aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 0) t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return Math.hypot(a.x + t * abx - p.x, a.y + t * aby - p.y);
}

/** Whether segments p1–p2 and p3–p4 properly cross. */
export function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Shortest distance between two segments (0 if they cross). */
export function segmentDistance(a1: Point, a2: Point, b1: Point, b2: Point): number {
  if (segmentsIntersect(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

/** Whether the eraser segment `e1`–`e2` (with the given radius) touches the stroke. */
export function strokeTouched(stroke: Stroke, e1: Point, e2: Point, radius: number): boolean {
  const reach = radius + stroke.width / 2;
  const bounds = strokeBounds(stroke);
  if (!bounds || !intersects(bounds, outset(rectFromPoints(e1, e2), reach))) return false;
  const pts = stroke.points;
  if (pts.length === 1) return pointSegmentDistance(pts[0], e1, e2) <= reach;
  for (let i = 0; i < pts.length - 1; i++) {
    if (segmentDistance(pts[i], pts[i + 1], e1, e2) <= reach) return true;
  }
  return false;
}

export function strokesTouched(strokes: readonly Stroke[], e1: Point, e2: Point, radius: number): string[] {
  return strokes.filter((s) => strokeTouched(s, e1, e2, radius)).map((s) => s.id);
}

/** Even-odd point-in-polygon test. The polygon is closed implicitly. */
export function polygonContains(polygon: readonly Point[], p: Point): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Fraction of a stroke's points that must be inside the lasso for it to be picked up. */
export const LASSO_THRESHOLD = 0.5;

export function strokesInLasso(lasso: readonly Point[], strokes: readonly Stroke[]): string[] {
  const box = boundsOf(lasso);
  if (lasso.length < 3 || !box) return [];
  return strokes
    .filter((s) => {
      const b = strokeBounds(s);
      if (!b || !intersects(b, box)) return false;
      const inside = s.points.reduce((n, p) => n + (polygonContains(lasso, p) ? 1 : 0), 0);
      return inside / s.points.length >= LASSO_THRESHOLD;
    })
    .map((s) => s.id);
}

/** Math items whose center is inside the lasso. */
export function mathItemsInLasso(lasso: readonly Point[], items: readonly MathItem[]): string[] {
  return items.filter((m) => polygonContains(lasso, center(mathBounds(m)))).map((m) => m.id);
}

/** The topmost math item under `p` (with some slack), if any. */
export function mathItemAt(p: Point, items: readonly MathItem[], slack = 0): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (contains(outset(mathBounds(items[i]), slack), p)) return items[i].id;
  }
  return null;
}

/** Math items the eraser segment passes over. */
export function mathItemsTouched(items: readonly MathItem[], e1: Point, e2: Point, radius: number): string[] {
  return items
    .filter((m) => {
      const r: Rect = outset(mathBounds(m), radius);
      if (contains(r, e1) || contains(r, e2)) return true;
      const c = [
        { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h },
      ];
      return c.some((a, i) => segmentsIntersect(e1, e2, a, c[(i + 1) % 4]));
    })
    .map((m) => m.id);
}

/** Embeds whose center is inside the lasso. */
export function embedsInLasso(lasso: readonly Point[], items: readonly EmbedItem[]): string[] {
  return items.filter((e) => polygonContains(lasso, center(embedBounds(e)))).map((e) => e.id);
}

/** The topmost embed under `p`, and whether `p` is on its header (the handle) or its content. */
export function embedAt(p: Point, items: readonly EmbedItem[], slack = 0): { id: string; part: "header" | "body" } | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const e = items[i];
    const r = embedBounds(e);
    if (!contains(outset(r, slack), p)) continue;
    return { id: e.id, part: p.y < r.y + EMBED_HEADER * e.scale ? "header" : "body" };
  }
  return null;
}
