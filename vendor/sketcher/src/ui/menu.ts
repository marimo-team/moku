// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/ui/menu.ts. Edit it there and rerun scripts/sketcher.ts.
import { h } from "./dom";

export type MenuEntry =
  | { label: string; shortcut?: string; disabled?: boolean; checked?: boolean; action: () => void }
  | "separator";

/** A small HTML context menu inside the sketcher. */
export class ContextMenu {
  readonly el: HTMLElement;

  constructor(private readonly host: HTMLElement) {
    this.el = h("div", { class: "sk-menu sk-glass", role: "menu", hidden: "" });
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(x: number, y: number, entries: MenuEntry[]): void {
    this.el.replaceChildren(
      ...entries.map((entry) => {
        if (entry === "separator") return h("hr");
        const label = entry.checked === undefined ? entry.label : `${entry.checked ? "✓" : "\u2003"} ${entry.label}`;
        const b = h("button", { type: "button", role: "menuitem" }, [label]);
        if (entry.shortcut) b.append(h("kbd", {}, [entry.shortcut]));
        b.disabled = !!entry.disabled;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.close();
          entry.action();
        });
        return b;
      }),
    );
    this.el.hidden = false;
    const w = this.el.offsetWidth, hgt = this.el.offsetHeight;
    const maxX = this.host.clientWidth - w - 4, maxY = this.host.clientHeight - hgt - 4;
    this.el.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
    this.el.style.top = `${Math.max(4, Math.min(y, maxY))}px`;
  }

  close(): void {
    this.el.hidden = true;
  }
}
