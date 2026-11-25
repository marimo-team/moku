// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/ui/mathEditor.ts. Edit it there and rerun scripts/sketcher.ts.
import type { Rect } from "../core/geometry";
import type { RGBA } from "../core/model";
import { type Theme, css } from "../core/theme";
import { sizedSVG, typeset } from "../math/typeset";
import { h, isMac, isolate, placePopover, shortcut } from "./dom";

export interface MathEditorActions {
  commit(latex: string): void;
  cancel(): void;
}

const PREVIEW_FONT = 28;

/** A small popover for editing a math item's LaTeX, with a live preview. */
export class MathEditor {
  readonly el: HTMLDivElement;
  private readonly preview: HTMLDivElement;
  private readonly text: HTMLTextAreaElement;
  private theme: Theme | null = null;
  private color: RGBA | null = null;
  /** The item being edited. */
  id: string | null = null;

  constructor(private readonly host: HTMLElement, private readonly actions: MathEditorActions) {
    this.preview = h("div", { class: "sk-editor-preview" });
    this.text = h("textarea", { class: "sk-editor-text", spellcheck: "false", autocapitalize: "off", "aria-label": "LaTeX" });
    const cancel = h("button", { type: "button", class: "sk-editor-button" }, ["Cancel"]);
    const done = h("button", { type: "button", class: "sk-editor-button sk-primary", title: shortcut("↩") }, ["Done"]);
    cancel.addEventListener("click", () => this.actions.cancel());
    done.addEventListener("click", () => this.actions.commit(this.text.value));
    this.el = h("div", { class: "sk-editor sk-glass", hidden: "" }, [
      this.preview,
      this.text,
      h("div", { class: "sk-editor-buttons" }, [cancel, done]),
    ]);
    this.text.addEventListener("input", () => this.updatePreview());
    // Keys typed here belong to the editor, not the board or the notebook around it.
    this.el.addEventListener("keydown", (e) => {
      e.stopPropagation();
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === "Escape") {
        e.preventDefault();
        this.actions.cancel();
      } else if (e.key === "Enter" && mod) {
        e.preventDefault();
        this.actions.commit(this.text.value);
      }
    });
    isolate(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(id: string, latex: string, anchor: Rect, theme: Theme, color: RGBA): void {
    this.id = id;
    this.theme = theme;
    this.color = color;
    this.text.value = latex;
    this.el.hidden = false;
    this.updatePreview();
    this.position(anchor);
    this.text.focus({ preventScroll: true });
    this.text.select();
  }

  close(): void {
    this.el.hidden = true;
    this.id = null;
  }

  /** Places the popover below the item (or above it if there's no room), inside the board. */
  position(anchor: Rect): void {
    placePopover(this.el, anchor, this.host);
  }

  private updatePreview(): void {
    const t = typeset(this.text.value);
    if (!t || !this.theme) {
      this.preview.replaceChildren(h("span", { class: "sk-editor-invalid" }, ["Can't typeset this yet"]));
      return;
    }
    let w = t.w * PREVIEW_FONT, hgt = t.h * PREVIEW_FONT;
    const fit = Math.min(1, 360 / w, 120 / hgt);
    w *= fit;
    hgt *= fit;
    this.preview.innerHTML = sizedSVG(t, w, hgt, css(this.color ?? this.theme.palette[0]));
    this.preview.style.background = css(this.theme.paper);
  }
}
