// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/canvas/undo.ts. Edit it there and rerun scripts/sketcher.ts.
import type { Drawing } from "../core/model";

interface Step {
  drawing: Drawing;
  name: string;
}

/** Whole-drawing snapshots: one step per gesture. */
export class UndoStack {
  private undos: Step[] = [];
  private redos: Step[] = [];

  constructor(private readonly limit = 500) {}

  /** Records that `before` was replaced under `name`. */
  push(before: Drawing, name: string): void {
    this.undos.push({ drawing: before, name });
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
  }

  get canUndo(): boolean {
    return this.undos.length > 0;
  }

  get canRedo(): boolean {
    return this.redos.length > 0;
  }

  get undoName(): string | null {
    return this.undos.at(-1)?.name ?? null;
  }

  get redoName(): string | null {
    return this.redos.at(-1)?.name ?? null;
  }

  /** Returns the drawing to restore, given the current one. */
  undo(current: Drawing): Step | null {
    const step = this.undos.pop();
    if (!step) return null;
    this.redos.push({ drawing: current, name: step.name });
    return step;
  }

  redo(current: Drawing): Step | null {
    const step = this.redos.pop();
    if (!step) return null;
    this.undos.push({ drawing: current, name: step.name });
    return step;
  }

  clear(): void {
    this.undos = [];
    this.redos = [];
  }
}
