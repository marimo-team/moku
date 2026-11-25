// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/ui/toast.ts. Edit it there and rerun scripts/sketcher.ts.
import { h } from "./dom";

/** A short message at the bottom of the board. Click to dismiss. */
export class Toast {
  readonly el: HTMLDivElement;
  private timer = 0;

  constructor() {
    this.el = h("div", { class: "sk-toast sk-glass", role: "status", hidden: "" });
    this.el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.hide();
    });
  }

  show(message: string, ms = 6000): void {
    this.el.textContent = message;
    this.el.hidden = false;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide(): void {
    clearTimeout(this.timer);
    this.el.hidden = true;
  }
}
