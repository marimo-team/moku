// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/core/theme.ts. Edit it there and rerun scripts/sketcher.ts.
import { MARKER_ALPHA, type MathItem, type RGBA, type Stroke, rgba } from "./model";

/** Ink on paper: black, gray, blue, red, green, yellow. */
export const LIGHT_PALETTE: readonly RGBA[] = [
  rgba(0.11, 0.11, 0.12),
  rgba(0.54, 0.54, 0.56),
  rgba(0.05, 0.42, 0.88),
  rgba(0.86, 0.2, 0.2),
  rgba(0.13, 0.56, 0.32),
  rgba(0.98, 0.74, 0.1),
];

/** Chalk on slate, slot for slot: white, gray, sky, coral, mint, yellow. */
export const DARK_PALETTE: readonly RGBA[] = [
  rgba(0.95, 0.95, 0.93),
  rgba(0.62, 0.62, 0.64),
  rgba(0.42, 0.72, 1.0),
  rgba(1.0, 0.47, 0.43),
  rgba(0.38, 0.85, 0.56),
  rgba(1.0, 0.85, 0.32),
];

/** Light ("paper") or dark ("slate") board styling. */
export class Theme {
  static readonly light = new Theme(false);
  static readonly dark = new Theme(true);

  private constructor(readonly isDark: boolean) {}

  static of(isDark: boolean): Theme {
    return isDark ? Theme.dark : Theme.light;
  }

  get paper(): RGBA {
    return this.isDark ? rgba(0.118, 0.122, 0.133) : rgba(0.985, 0.983, 0.972);
  }

  /** Color for background dots. */
  get patternColor(): RGBA {
    return this.isDark ? rgba(1, 1, 1, 0.14) : rgba(0, 0, 0, 0.16);
  }

  get gridLineColor(): RGBA {
    return this.isDark ? rgba(1, 1, 1, 0.07) : rgba(0, 0, 0, 0.07);
  }

  /** UI foreground (icons, labels). */
  get ink(): RGBA {
    return this.isDark ? rgba(0.95, 0.95, 0.95) : rgba(0.12, 0.12, 0.12);
  }

  get palette(): readonly RGBA[] {
    return this.isDark ? DARK_PALETTE : LIGHT_PALETTE;
  }

  /** Opacity of a highlight layer; overlapping same-color highlights stay at this opacity. */
  get markerAlpha(): number {
    return this.isDark ? 0.55 : MARKER_ALPHA;
  }

  /** Multiply darkens like highlighter ink on paper; it would vanish on slate. */
  get markerBlend(): GlobalCompositeOperation {
    return this.isDark ? "source-over" : "multiply";
  }

  color(swatch: number | null, fallback: RGBA): RGBA {
    return swatch !== null && swatch >= 0 && swatch < this.palette.length ? this.palette[swatch] : fallback;
  }

  strokeColor(s: Stroke): RGBA {
    return this.color(s.swatch, s.color);
  }

  mathColor(m: MathItem): RGBA {
    return this.color(m.swatch, m.color);
  }

  /** Final color of a lone stroke, including marker translucency. */
  renderColor(s: Stroke): RGBA {
    const c = this.strokeColor(s);
    return s.tool === "marker" ? { ...c, a: c.a * this.markerAlpha } : c;
  }
}

export function css(c: RGBA, alpha = 1): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgba(${to(c.r)}, ${to(c.g)}, ${to(c.b)}, ${c.a * alpha})`;
}

export const sameColor = (a: RGBA, b: RGBA) => a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
