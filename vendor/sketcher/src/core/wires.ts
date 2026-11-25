// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/core/wires.ts. Edit it there and rerun scripts/sketcher.ts.
// Where a wire between two cards runs: a curve from the side of one card facing the other to the
// facing side of the other. Pure geometry, shared by drawing, hit testing and export.
import { type Point, type Rect, center, contains, outset } from "./geometry";
import { pointSegmentDistance } from "./hitTest";

/** A cubic Bézier: start, two control points, end. */
export interface WireCurve {
  a: Point;
  c1: Point;
  c2: Point;
  b: Point;
}

/** Where a ray from the middle of `r` towards `toward` leaves it, and which way it leaves. */
function exit(r: Rect, toward: Point): { p: Point; n: Point } {
  const c = center(r);
  const dx = toward.x - c.x, dy = toward.y - c.y;
  // Leave through the side the other end is most clearly beyond, from the middle of that side.
  if (Math.abs(dx) * r.h >= Math.abs(dy) * r.w) {
    const s = Math.sign(dx) || 1;
    return { p: { x: c.x + (s * r.w) / 2, y: c.y }, n: { x: s, y: 0 } };
  }
  const s = Math.sign(dy) || 1;
  return { p: { x: c.x, y: c.y + (s * r.h) / 2 }, n: { x: 0, y: s } };
}

/** The curve from card `from` to card `to`, or to a point (while a wire is being dragged). */
export function wireCurve(from: Rect, to: Rect | Point): WireCurve {
  const target = "w" in to ? center(to) : to;
  const start = exit(from, target);
  const end = "w" in to ? exit(to, start.p) : { p: to, n: { x: 0, y: 0 } };
  const d = Math.hypot(end.p.x - start.p.x, end.p.y - start.p.y);
  const bend = Math.max(24, Math.min(160, d / 2.5));
  return {
    a: start.p,
    c1: { x: start.p.x + start.n.x * bend, y: start.p.y + start.n.y * bend },
    c2: { x: end.p.x + end.n.x * bend, y: end.p.y + end.n.y * bend },
    b: end.p,
  };
}

export function pointOnWire(w: WireCurve, t: number): Point {
  const u = 1 - t;
  const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
  return {
    x: k0 * w.a.x + k1 * w.c1.x + k2 * w.c2.x + k3 * w.b.x,
    y: k0 * w.a.y + k1 * w.c1.y + k2 * w.c2.y + k3 * w.b.y,
  };
}

/** Points along the curve, for hit testing. */
export function sampleWire(w: WireCurve, n = 24): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => pointOnWire(w, i / n));
}

/** How far `p` is from the curve. */
export function wireDistance(w: WireCurve, p: Point): number {
  const pts = sampleWire(w);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, pointSegmentDistance(p, pts[i], pts[i + 1]));
  return best;
}

/** The direction the curve arrives in at its end, as a unit vector. */
export function wireHeading(w: WireCurve): Point {
  const near = pointOnWire(w, 0.97);
  const dx = w.b.x - near.x, dy = w.b.y - near.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * The topmost of `wires` within `slack` of `p`, skipping points inside the cards (`avoid`), where a
 * click belongs to the card.
 */
export function wireAt<T extends { curve: WireCurve }>(
  p: Point, wires: readonly T[], slack: number, avoid: readonly Rect[] = [],
): T | null {
  if (avoid.some((r) => contains(outset(r, -slack / 2), p))) return null;
  let best: T | null = null, bestDistance = slack;
  for (const w of wires) {
    const d = wireDistance(w.curve, p);
    if (d <= bestDistance) {
      best = w;
      bestDistance = d;
    }
  }
  return best;
}
