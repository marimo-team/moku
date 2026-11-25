// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/canvas/tools.ts. Edit it there and rerun scripts/sketcher.ts.
/** `connect` drags a wire from one card to another (only when the host can connect cards). */
export type Tool = "pen" | "marker" | "eraser" | "select" | "connect";

/** Thin / medium / thick, in view points. */
export const PEN_WIDTHS = [1.5, 3, 6] as const;
export const MARKER_WIDTHS = [10, 20, 36] as const;
/** Eraser radius in view points. */
export const ERASER_RADIUS = 10;
/** Minimum distance between captured points, in view points. */
export const MIN_POINT_SPACING = 1.5;

/** Tool, width and color choice for one sketcher. */
export class ToolState {
  tool: Tool = "pen";
  widthIndex = 1;
  swatch = 0;

  /** Line width in view points for the current tool. */
  get screenWidth(): number {
    switch (this.tool) {
      case "marker":
        return MARKER_WIDTHS[this.widthIndex];
      case "eraser":
        return ERASER_RADIUS * 2;
      default:
        return PEN_WIDTHS[this.widthIndex];
    }
  }

  adjustWidth(delta: number): void {
    this.widthIndex = Math.max(0, Math.min(2, this.widthIndex + delta));
  }

  /** Picking a color goes back to drawing. */
  selectSwatch(index: number): void {
    this.swatch = index;
    if (this.tool === "eraser" || this.tool === "select" || this.tool === "connect") this.tool = "pen";
  }
}
