// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/ui/selectionBar.ts. Edit it there and rerun scripts/sketcher.ts.
import { h, iconButton, shortcut } from "./dom";
import { icons } from "./icons";

export interface SelectionBarState {
  canAsk: boolean;
  canConvert: boolean;
  canEdit: boolean;
  canRevert: boolean;
  canCopyLatex: boolean;
}

export interface SelectionBarActions {
  ask(): void;
  convert(): void;
  edit(): void;
  revert(): void;
  copyLatex(): void;
  delete(): void;
}

/** The floating buttons above a selection. */
export class SelectionBar {
  readonly el: HTMLDivElement;
  private readonly buttons: Record<keyof SelectionBarState | "delete", HTMLButtonElement>;

  constructor(actions: SelectionBarActions) {
    const convert = iconButton(icons.latex, `Convert to LaTeX (${shortcut("L")})`, () => actions.convert());
    convert.append(h("span", {}, ["LaTeX"]));
    const ask = iconButton(icons.sparkles, `Ask Claude (${shortcut("K")})`, () => actions.ask());
    ask.append(h("span", {}, ["Ask"]));
    this.buttons = {
      canAsk: ask,
      canConvert: convert,
      canEdit: iconButton(icons.pen, "Edit LaTeX (Return)", () => actions.edit()),
      canRevert: iconButton(icons.revert, "Revert to Ink", () => actions.revert()),
      canCopyLatex: iconButton(icons.copy, "Copy LaTeX", () => actions.copyLatex()),
      delete: iconButton(icons.trash, "Delete (⌫)", () => actions.delete()),
    };
    this.el = h("div", { class: "sk-selection-bar sk-glass", hidden: "" }, Object.values(this.buttons));
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  update(state: SelectionBarState): void {
    for (const key of ["canAsk", "canConvert", "canEdit", "canRevert", "canCopyLatex"] as const) {
      this.buttons[key].hidden = !state[key];
    }
  }
}
