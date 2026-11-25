// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/core/smoothing.ts. Edit it there and rerun scripts/sketcher.ts.
import type { Point } from "./geometry";

/** Anything with the CanvasPath drawing methods we need (Path2D, a 2D context). */
export interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
}

/** Quadratic curves through segment midpoints. A single point becomes a dot (with round caps). */
export function smoothPath<T extends PathSink>(points: readonly Point[], sink: T): T {
  const n = points.length;
  if (n === 0) return sink;
  const p0 = points[0];
  sink.moveTo(p0.x, p0.y);
  if (n === 1) {
    sink.lineTo(p0.x, p0.y);
    return sink;
  }
  if (n === 2) {
    sink.lineTo(points[1].x, points[1].y);
    return sink;
  }
  for (let i = 1; i < n - 1; i++) {
    const p = points[i], q = points[i + 1];
    sink.quadraticCurveTo(p.x, p.y, (p.x + q.x) / 2, (p.y + q.y) / 2);
  }
  sink.lineTo(points[n - 1].x, points[n - 1].y);
  return sink;
}
