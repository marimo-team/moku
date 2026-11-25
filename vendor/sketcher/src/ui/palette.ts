// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/ui/palette.ts. Edit it there and rerun scripts/sketcher.ts.
import type { Background } from "../core/model";
import { type Theme, css } from "../core/theme";
import type { Tool } from "../canvas/tools";
import { h, iconButton } from "./dom";
import { icons } from "./icons";

export interface PaletteState {
  tool: Tool;
  widthIndex: number;
  swatch: number;
  theme: Theme;
  background: Background;
  canUndo: boolean;
  canRedo: boolean;
}

export interface PaletteActions {
  setTool(tool: Tool): void;
  setWidth(index: number): void;
  setSwatch(index: number): void;
  cycleBackground(): void;
  toggleTheme(): void;
  undo(): void;
  redo(): void;
}

const TOOLS: { tool: Tool; title: string }[] = [
  { tool: "pen", title: "Pen (P)" },
  { tool: "marker", title: "Marker (M)" },
  { tool: "eraser", title: "Eraser (E)" },
  { tool: "select", title: "Select (S)" },
  { tool: "connect", title: "Connect cards (C): drag from one card to another" },
];
const WIDTH_NAMES = ["Thin", "Medium", "Thick"];
const BACKGROUND_NAMES: Record<Background, string> = { plain: "Plain", dots: "Dots", grid: "Grid" };

/** The floating tool strip on the left edge. */
export class Palette {
  readonly el: HTMLElement;
  private readonly toolButtons: HTMLButtonElement[];
  private readonly widthButtons: HTMLButtonElement[];
  private readonly swatchButtons: HTMLButtonElement[];
  private readonly backgroundButton: HTMLButtonElement;
  private readonly themeButton: HTMLButtonElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;

  /** `connect` adds the Connect tool, for hosts that can connect cards. */
  constructor(actions: PaletteActions, { connect = false } = {}) {
    this.toolButtons = TOOLS.map(({ tool, title }) => {
      const b = iconButton(icons[tool], title, () => actions.setTool(tool));
      if (tool === "connect" && !connect) b.hidden = true;
      return b;
    });
    this.widthButtons = WIDTH_NAMES.map((name, i) => {
      const b = iconButton("", `${name} ([ / ])`, () => actions.setWidth(i), "sk-width");
      const d = 3 + i * 2.5;
      b.append(h("span", { style: `width:${d}px;height:${d}px` }));
      return b;
    });
    this.swatchButtons = Array.from({ length: 6 }, (_, i) => {
      const b = iconButton("", `Color ${i + 1}`, () => actions.setSwatch(i), "sk-swatch");
      b.append(h("span"));
      return b;
    });
    this.backgroundButton = iconButton("", "Background", () => actions.cycleBackground(), "sk-small");
    this.themeButton = iconButton("", "", () => actions.toggleTheme(), "sk-small");
    this.undoButton = iconButton(icons.undo, "Undo", () => actions.undo(), "sk-small");
    this.redoButton = iconButton(icons.redo, "Redo", () => actions.redo(), "sk-small");

    const section = (children: HTMLElement[]) => h("div", { class: "sk-section" }, children);
    const divider = () => h("div", { class: "sk-divider" });
    this.el = h("div", { class: "sk-palette sk-glass" }, [
      section(this.toolButtons),
      divider(),
      section(this.widthButtons),
      divider(),
      section(this.swatchButtons),
      divider(),
      section([this.backgroundButton, this.themeButton, this.undoButton, this.redoButton]),
    ]);
    this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  update(s: PaletteState): void {
    this.toolButtons.forEach((b, i) => b.classList.toggle("sk-on", TOOLS[i].tool === s.tool));
    this.widthButtons.forEach((b, i) => b.classList.toggle("sk-on", i === s.widthIndex));
    this.swatchButtons.forEach((b, i) => {
      b.classList.toggle("sk-on", i === s.swatch && (s.tool === "pen" || s.tool === "marker"));
      (b.firstElementChild as HTMLElement).style.background = css(s.theme.palette[i]);
    });
    const next = { plain: "dots", dots: "grid", grid: "plain" } as const;
    this.backgroundButton.innerHTML = icons[s.background];
    this.backgroundButton.title = `Background: ${BACKGROUND_NAMES[s.background]} (click for ${BACKGROUND_NAMES[next[s.background]]})`;
    this.themeButton.innerHTML = s.theme.isDark ? icons.sun : icons.moon;
    this.themeButton.title = s.theme.isDark ? "Light board" : "Dark board";
    this.undoButton.disabled = !s.canUndo;
    this.redoButton.disabled = !s.canRedo;
  }
}
