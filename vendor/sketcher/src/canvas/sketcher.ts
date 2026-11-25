// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/canvas/sketcher.ts. Edit it there and rerun scripts/sketcher.ts.
// The whiteboard component. Everything is scoped to the element it is mounted in, so several
// can live on one page (a notebook with several widgets, say).
import {
  type ArrowLink, type EmbedContent, arrowLinks, boundsOfIDs, converting, editingLatex, embedding, fragment as fragmentOf, inserting, linking,
  refiningEmbed, removing, revertingEmbedToInk, revertingToInk, scaling, translating, updatingEmbed, updatingLink,
} from "../core/edits";
import { type Point, type Rect, boundsOf, center, contains, distance, outset } from "../core/geometry";
import {
  embedAt, embedsInLasso, mathItemAt, mathItemsInLasso, mathItemsTouched, strokesInLasso, strokesTouched,
} from "../core/hitTest";
import {
  BACKGROUNDS, type Background, type Drawing, EMBED_HEADER, type EmbedItem, type LinkItem, type MathItem, type Stroke, contentBounds,
  embedBounds, emptyDrawing, isEmpty, mathBounds, newID, strokeBounds,
} from "../core/model";
import { type WireCurve, pointOnWire, wireAt as nearestWire, wireCurve } from "../core/wires";
import { smoothPath } from "../core/smoothing";
import { Theme, css } from "../core/theme";
import { Viewport } from "../core/viewport";
import { drawBackground } from "../render/background";
import { renderPNG } from "../render/export";
import { drawMath, fitMath, layoutSize, onMathImageLoad } from "../math/mathRenderer";
import { RecognizerError, type RunClaude, recognizeLatex } from "../math/recognizer";
import { isValidLatex } from "../math/typeset";
import { type Item, drawInk, drawWire, pathFor } from "../render/renderer";
import { type AskChip, AskPrompt } from "../ui/askPrompt";
import { h, isMac, shortcut } from "../ui/dom";
import { MathEditor } from "../ui/mathEditor";
import { ContextMenu, type MenuEntry } from "../ui/menu";
import { Palette } from "../ui/palette";
import { SelectionBar } from "../ui/selectionBar";
import { Toast } from "../ui/toast";
import styles from "../ui/styles.css?inline";
import { type Appearance, systemIsDark, watchSystemAppearance } from "./appearance";
import { copyImage, readFragment, writeFragment } from "./clipboard";
import { EmbedLayer, type MountEmbed, framesPath } from "./embedLayer";
import { ERASER_RADIUS, MIN_POINT_SPACING, type Tool, ToolState } from "./tools";
import { UndoStack } from "./undo";

export type { Appearance } from "./appearance";
export type { Tool } from "./tools";
export type { MountEmbed } from "./embedLayer";

/** A selection and what the person wants it to become, for `SketcherOptions.ask`. */
export interface AskRequest {
  /** What the person asked for. Empty when they sent the sketch alone: work it out from `png`. */
  prompt: string;
  /** The selection on plain light paper (base64 PNG), embeds drawn as labelled boxes. */
  png: string;
  /** The whole board drawn the same way, with the selection outlined (base64 PNG). */
  context: string;
  /** Arrows drawn between the selection and the embeds around it (`null` is the selection). */
  arrows: ArrowLink[];
  /** The selection's bounds, in canvas coordinates. */
  bounds: Rect;
  /** A suggested size for a new embed, from the size of the selected handwriting. */
  size: { w: number; h: number };
  strokes: Stroke[];
  math: MathItem[];
  embeds: EmbedItem[];
  /** Aborted when the person cancels (Esc) while waiting. */
  signal: AbortSignal;
}

/** Other embeds an answer changes along the way (ones an arrow from the selection points at). */
export interface AskSideUpdate {
  id: string;
  data: Record<string, unknown> | null;
}

/** What to do with an answered `AskRequest`. `updates` are applied in the same undo step. */
export type AskResult =
  /** Replace the selected handwriting with a new embed. */
  | { kind: "insert"; ref: string; title: string; data: Record<string, unknown> | null; updates?: AskSideUpdate[] }
  /** Change a selected embed; the selected handwriting becomes part of its ink. */
  | {
    kind: "update"; id: string; ref?: string; title?: string; data?: Record<string, unknown> | null;
    updates?: AskSideUpdate[];
  }
  /** Leave the board alone, optionally telling the person why. */
  | { kind: "none"; message?: string };

/**
 * A dependency between two embeds the host knows of (by `ref`), such as one notebook cell reading
 * another's variable. Links the board has are checked against these; the rest show as ghosts.
 */
export interface Wire {
  from: string;
  to: string;
  /** What flows along it, e.g. a variable name. */
  label: string;
}

/** A wire dragged from one embed to another, and what the person wants the connection to do. */
export interface ConnectRequest {
  from: EmbedItem;
  to: EmbedItem;
  /** The link being changed, when an existing connection is asked about again. */
  link: LinkItem | null;
  /** What the person asked for. Empty: work out the most sensible connection. */
  prompt: string;
  /** The whole board with both cards outlined (base64 PNG). */
  context: string;
  /** Aborted when the person cancels (Esc) while waiting. */
  signal: AbortSignal;
}

/** What to do with an answered `ConnectRequest`. `updates` are applied in the same undo step. */
export type ConnectResult =
  | { kind: "link"; label: string; data: Record<string, unknown> | null; updates?: AskSideUpdate[] }
  | { kind: "none"; message?: string };

/** One thing an embed offers to others (a variable, say), shown as a chip when connecting from it. */
export type EmbedOutput = AskChip;

export interface SketcherOptions {
  drawing?: Drawing;
  appearance?: Appearance;
  /** Called once per committed edit (one gesture, undo, redo, …) with the new drawing. */
  onChange?: (drawing: Drawing, actionName: string) => void;
  /** Called when the board's light/dark toggle sets an explicit appearance. */
  onAppearanceChange?: (appearance: Appearance) => void;
  /** Called on Mod+S. Without it the key is left to the page. */
  onSave?: (drawing: Drawing) => void;
  /** Base name for exported images. */
  fileName?: string;
  /** Runs `claude -p` for Convert to LaTeX (the widget asks the Python kernel). */
  recognize?: RunClaude;
  /** Fills embed cards with live content. Without it a card shows its `ref`. */
  mountEmbed?: MountEmbed;
  /** Turns a selection and a prompt into an embed. Without it there is no Ask action. */
  ask?: (request: AskRequest) => Promise<AskResult>;
  /** Called on a double-click on an embed's header. */
  onEmbedOpen?: (item: EmbedItem) => void;
  /** Connects two embeds. Without it there is no Connect tool. */
  connect?: (request: ConnectRequest) => Promise<ConnectResult>;
  /** What an embed offers to others, for the connect prompt. */
  describeEmbed?: (item: EmbedItem) => readonly EmbedOutput[];
  /**
   * Called when a link is deleted on its own (not with a card). Returns changes to other embeds
   * to make in the same undo step, e.g. putting back the code from before the connection.
   */
  disconnect?: (link: LinkItem, signal: AbortSignal) => Promise<AskSideUpdate[]>;
  /** Called on a double-click on a link. */
  onLinkOpen?: (link: LinkItem) => void;
}

/** Work waiting on Claude: the items it's about (marching ants), a label, and a way to cancel. */
interface Pending {
  ids: Set<string>;
  label: string | null;
  abort: AbortController | null;
  /** A connection being made: the ants run along the wire instead of around the items. */
  wire?: { from: string; to: string };
}

/** A wire as drawn: a link, a dependency without one (ghost), or one being made. */
interface DrawnWire {
  key: string;
  curve: WireCurve;
  from: string;
  to: string;
  label: string;
  state: "linked" | "ghost" | "broken" | "pending" | "dragging";
  link: LinkItem | null;
}

/** `p' = p * s + t`: the live preview of a move or resize. */
interface Affine {
  s: number;
  tx: number;
  ty: number;
}
const IDENTITY: Affine = { s: 1, tx: 0, ty: 0 };
const applyRect = (r: Rect, t: Affine): Rect => ({ x: r.x * t.s + t.tx, y: r.y * t.s + t.ty, w: r.w * t.s, h: r.h * t.s });

type Gesture =
  | { kind: "stroke"; pointerId: number; stroke: Stroke }
  | { kind: "erase"; pointerId: number; last: Point }
  | { kind: "lasso"; pointerId: number; points: Point[] }
  | { kind: "move"; pointerId: number; anchor: Point; offset: Point }
  | { kind: "scale"; pointerId: number; anchor: Point; start: Point; factor: number }
  | { kind: "pan"; pointerId: number; last: Point }
  | { kind: "connect"; pointerId: number; from: string; to: string | null; point: Point }
  | { kind: "pinch"; last: { center: Point; spread: number } };

const ACCENT = { r: 0, g: 0.478, b: 1, a: 1 };
const RESIZE_HANDLE_RADIUS = 5;
const DOUBLE_CLICK_MS = 400;

export class Sketcher {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Above the embeds: ink drawn over them, selection chrome, lasso, pending outlines. */
  private readonly overlay: HTMLCanvasElement;
  private readonly octx: CanvasRenderingContext2D;
  private readonly embeds: EmbedLayer;
  private readonly askPrompt: AskPrompt;
  private readonly palette: Palette;
  private readonly selectionBar: SelectionBar;
  private readonly menu: ContextMenu;
  private readonly editor: MathEditor;
  private readonly toast = new Toast();
  private readonly cleanups: (() => void)[] = [];

  private drawing: Drawing;
  private viewport = new Viewport();
  private appearance: Appearance;
  private theme: Theme;
  readonly tools = new ToolState();
  private readonly history = new UndoStack();
  private selection = new Set<string>();
  private erased = new Set<string>();
  /** Hidden layers can't be selected or erased. */
  private showsInk = true;
  private showsMath = true;
  /** Items waiting on Claude, by request. */
  private readonly pending = new Map<string, Pending>();
  private pendingFrame = 0;

  /** Dependencies the host reported (see `setWires`), or null if it hasn't. */
  private hostWires: readonly Wire[] | null = null;
  /** Each link's data as of the last `setWires`: a link made or changed since isn't checked yet. */
  private checkedLinks = new Map<string, LinkItem>();
  /** A selected link (selection of board items and of a link are exclusive). */
  private selectedLink: string | null = null;
  /** The card or link under the pointer, whose wires show. */
  private hoveredEmbed: string | null = null;
  /** The card under the pointer as the canvas sees it (when cards don't take the pointer). */
  private hoveredCard: string | null = null;
  private hoveredLink: string | null = null;
  /** The two cards the Ask prompt is connecting, while it's open for that. */
  private connecting: { from: string; to: string; link: string | null } | null = null;

  private gesture: Gesture | null = null;
  private readonly touches = new Map<number, Point>();
  private spaceDown = false;
  /** Pointer position in view coordinates while it is over the canvas. */
  private hover: Point | null = null;
  private lastDown: { time: number; p: Point } | null = null;
  private pendingClipboard: "copy" | "cut" | "paste" | null = null;

  private size = { w: 0, h: 0 };
  private dpr = 1;
  private didInitialFit = false;
  private frame = 0;

  constructor(
    host: HTMLElement,
    private readonly options: SketcherOptions = {},
  ) {
    this.drawing = options.drawing ?? emptyDrawing();
    this.appearance = options.appearance ?? "system";
    this.theme = this.resolveTheme();

    this.root = h("div", {
      class: "sk-root",
      tabindex: "0",
      // Lumino (JupyterLab) skips its keyboard shortcuts inside elements marked like this.
      "data-lm-suppress-shortcuts": "true",
      "data-p-suppress-shortcuts": "true",
    });
    const style = h("style", {}, [styles]);
    this.canvas = h("canvas", { class: "sk-canvas" });
    this.ctx = this.canvas.getContext("2d")!;
    this.overlay = h("canvas", { class: "sk-overlay" });
    this.octx = this.overlay.getContext("2d")!;
    this.embeds = new EmbedLayer(options.mountEmbed, {
      fit: (id, size) => this.updateEmbed(id, { size }, { undoable: false, name: "Fit Embed" }),
      wheel: (e) => this.wheel(e),
      hover: (id) => {
        if (this.hoveredEmbed === id) return;
        this.hoveredEmbed = id;
        this.requestRender();
      },
    });
    this.palette = new Palette({
      setTool: (t) => this.setTool(t),
      setWidth: (i) => {
        this.tools.widthIndex = i;
        this.toolsChanged();
      },
      setSwatch: (i) => this.selectSwatch(i),
      cycleBackground: () => {
        const i = BACKGROUNDS.indexOf(this.drawing.background);
        this.setBackground(BACKGROUNDS[(i + 1) % BACKGROUNDS.length]);
      },
      toggleTheme: () => {
        const next = this.theme.isDark ? "light" : "dark";
        this.setAppearance(next);
        this.options.onAppearanceChange?.(next);
      },
      undo: () => this.undo(),
      redo: () => this.redo(),
    }, { connect: !!options.connect });
    this.selectionBar = new SelectionBar({
      ask: () => this.openAsk(),
      convert: () => void this.convertToLatex(),
      edit: () => this.editLatex(),
      revert: () => this.revertToInk(),
      copyLatex: () => this.copyLatex(),
      delete: () => this.deleteSelection(),
    });
    this.menu = new ContextMenu(this.root);
    this.editor = new MathEditor(this.root, {
      commit: (latex) => this.commitLatexEdit(latex),
      cancel: () => this.closeEditor(),
    });
    this.askPrompt = new AskPrompt(this.root, {
      submit: (prompt) => {
        const connecting = this.connecting;
        this.closeAsk();
        if (connecting) void this.connect(connecting.from, connecting.to, prompt, connecting.link);
        else void this.ask(prompt);
      },
      cancel: () => this.closeAsk(),
    });
    this.root.append(
      style, this.canvas, this.embeds.el, this.overlay, this.palette.el, this.selectionBar.el, this.editor.el,
      this.askPrompt.el, this.menu.el, this.toast.el,
    );
    host.append(this.root);

    this.listen();
    this.toolsChanged();
  }

  // MARK: Public API

  getDrawing(): Drawing {
    return this.drawing;
  }

  getSelection(): ReadonlySet<string> {
    return this.selection;
  }

  /** Selects these items (switching to the select tool), ignoring IDs that aren't on the board. */
  setSelection(ids: Iterable<string>): void {
    const available = this.selectableIDs;
    this.tools.tool = "select";
    this.selectedLink = null;
    this.selection = new Set([...ids].filter((id) => available.has(id)));
    this.toolsChanged();
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  /** Replaces the board, e.g. when a file is opened or Python sets it. Clears undo history. */
  setDrawing(drawing: Drawing, { fit = false } = {}): void {
    this.cancelGesture();
    this.drawing = drawing;
    this.history.clear();
    this.pruneSelection();
    if (fit) this.zoomToFit();
    this.toolsChanged();
  }

  setAppearance(appearance: Appearance): void {
    this.appearance = appearance;
    this.themeChanged();
  }

  setTool(tool: Tool): void {
    if (tool === "connect" && !this.options.connect) return;
    if (tool !== "select") {
      this.selection.clear();
      this.selectedLink = null;
    }
    this.tools.tool = tool;
    this.toolsChanged();
  }

  selectSwatch(index: number): void {
    this.tools.selectSwatch(index);
    if (this.tools.tool !== "select") this.selection.clear();
    this.toolsChanged();
  }

  setBackground(background: Background): void {
    if (background === this.drawing.background) return;
    this.commit({ ...this.drawing, background }, "Change Background");
  }

  undo(): void {
    const step = this.history.undo(this.drawing);
    if (step) this.applyHistory(step.drawing, `Undo ${step.name}`);
  }

  redo(): void {
    const step = this.history.redo(this.drawing);
    if (step) this.applyHistory(step.drawing, `Redo ${step.name}`);
  }

  zoomToFit(): void {
    this.viewport = Viewport.fitting(contentBounds(this.drawing), this.size);
    this.requestRender();
  }

  zoomToActualSize(): void {
    this.viewport = this.viewport.zoomedTo(1, this.viewCenter);
    this.requestRender();
  }

  zoomBy(factor: number): void {
    this.viewport = this.viewport.zoomed(factor, this.viewCenter);
    this.requestRender();
  }

  selectAll(): void {
    this.tools.tool = "select";
    this.selectedLink = null;
    this.selection = this.selectableIDs;
    this.toolsChanged();
  }

  clearCanvas(): void {
    if (isEmpty(this.drawing)) return;
    this.selection.clear();
    this.selectedLink = null;
    this.commit({ ...this.drawing, strokes: [], math: [], embeds: [], links: [] }, "Clear Canvas");
  }

  deleteSelection(): void {
    if (this.selectedLink) {
      void this.deleteLink(this.selectedLink);
      return;
    }
    if (this.selection.size === 0) return;
    const next = removing(this.drawing, this.selection);
    this.selection.clear();
    this.commit(next, "Delete");
  }

  /** PNG of the selection, or of the whole board. */
  imagePNG(): Promise<Blob | null> {
    return renderPNG(this.exportDrawing, this.theme);
  }

  async exportPNG(): Promise<void> {
    const blob = await renderPNG(this.drawing, this.theme);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: `${this.options.fileName ?? "Sketch"}.png` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  copyAsImage(): void {
    copyImage(this.imagePNG()).catch(() => {});
  }

  /** Shows or hides the ink and math layers. Hidden things can't be selected or erased. */
  setLayerVisibility({ ink = this.showsInk, math = this.showsMath }: { ink?: boolean; math?: boolean }): void {
    this.showsInk = ink;
    this.showsMath = math;
    this.pruneSelection();
    this.toolsChanged();
  }

  getLayerVisibility(): { ink: boolean; math: boolean } {
    return { ink: this.showsInk, math: this.showsMath };
  }

  // MARK: Embeds

  getEmbeds(): readonly EmbedItem[] {
    return this.drawing.embeds;
  }

  /**
   * Adds an embed, by default in the middle of the view at the content's natural size.
   * Can be undone. Returns its ID.
   */
  insertEmbed(
    content: EmbedContent, { origin, size = { w: 480, h: 320 }, select = true }: { origin?: Point; size?: { w: number; h: number }; select?: boolean } = {},
  ): string {
    const at = origin ?? (() => {
      const c = this.viewport.toCanvas(this.viewCenter);
      return { x: c.x - size.w / 2, y: c.y - size.h / 2 };
    })();
    const { drawing, id } = embedding(this.drawing, new Set(), at, size, content);
    if (select) {
      this.tools.tool = "select";
      this.selection = new Set([id]);
    }
    this.commit(drawing, "Insert");
    return id;
  }

  /**
   * Changes an embed. With `undoable: false` the change isn't recorded for undo (for things the
   * host keeps in step by itself, like a card fitting its content); `onChange` still hears of it.
   */
  updateEmbed(
    id: string, patch: Partial<Omit<EmbedItem, "id">>, { undoable = true, name = "Change" }: { undoable?: boolean; name?: string } = {},
  ): void {
    if (!this.drawing.embeds.some((e) => e.id === id)) return;
    const next = updatingEmbed(this.drawing, id, patch);
    if (undoable) {
      this.commit(next, name);
      return;
    }
    this.drawing = next;
    this.toolsChanged();
    this.options.onChange?.(next, name);
  }

  // MARK: Links

  getLinks(): readonly LinkItem[] {
    return this.drawing.links;
  }

  /**
   * Tells the board which embeds depend on which (by `ref`), e.g. from a notebook's dataflow. A
   * link with no such dependency shows as broken; a dependency with no link shows as a ghost wire.
   */
  setWires(wires: readonly Wire[]): void {
    this.hostWires = wires;
    this.checkedLinks = new Map(this.drawing.links.map((l) => [l.id, l]));
    this.requestRender();
  }

  /**
   * Changes a link's label or host data. With `undoable: false` the change isn't recorded for undo
   * (for things the host keeps in step by itself); `onChange` still hears of it.
   */
  updateLink(
    id: string, patch: Partial<Pick<LinkItem, "label" | "data">>, { undoable = true, name = "Change" }: { undoable?: boolean; name?: string } = {},
  ): void {
    if (!this.drawing.links.some((l) => l.id === id)) return;
    const next = updatingLink(this.drawing, id, patch);
    if (undoable) {
      this.commit(next, name);
      return;
    }
    this.drawing = next;
    this.toolsChanged();
    this.options.onChange?.(next, name);
  }

  /** Selects a link (switching to the select tool). */
  selectLink(id: string | null): void {
    if (id !== null && !this.drawing.links.some((l) => l.id === id)) return;
    this.tools.tool = "select";
    this.selection.clear();
    this.selectedLink = id;
    this.toolsChanged();
  }

  getSelectedLink(): LinkItem | null {
    return this.drawing.links.find((l) => l.id === this.selectedLink) ?? null;
  }

  /**
   * Opens the connect prompt for a wire from one embed to another (or, with `link`, to ask about
   * an existing connection again). Needs a `connect` option.
   */
  openConnect(from: string, to: string, link: string | null = null): void {
    const a = this.drawing.embeds.find((e) => e.id === from), b = this.drawing.embeds.find((e) => e.id === to);
    if (!this.options.connect || !a || !b || a === b) return;
    this.menu.close();
    this.closeEditor();
    this.closeAsk();
    this.connecting = { from, to, link };
    const name = (e: EmbedItem) => `“${e.title || e.ref}”`;
    this.askPrompt.open(
      link ? `How should ${name(a)} → ${name(b)} change?` : `Connect ${name(a)} → ${name(b)}`,
      this.connectAnchor(a, b),
      {
        chips: this.options.describeEmbed?.(a) ?? [],
        placeholder: `How should ${name(b)} use it? Click an output above, or press ↩ to let Claude decide`,
        action: link ? "Ask" : "Connect",
      },
    );
    this.requestRender();
  }

  /** Where the connect prompt goes: around the middle of the wire, in view coordinates. */
  private connectAnchor(a: EmbedItem, b: EmbedItem): Rect {
    const mid = this.viewport.toView(pointOnWire(wireCurve(embedBounds(a), embedBounds(b)), 0.5));
    return { x: mid.x - 1, y: mid.y - 1, w: 2, h: 2 };
  }

  /**
   * Asks the host (and so, Claude) to connect two embeds: the answer becomes a link between them,
   * plus whatever it changes in the cards, in one undo step. The wire shows marching ants meanwhile.
   */
  async connect(from: string, to: string, prompt: string, link: string | null = null): Promise<boolean> {
    const connect = this.options.connect;
    const a = this.drawing.embeds.find((e) => e.id === from), b = this.drawing.embeds.find((e) => e.id === to);
    if (!connect || !a || !b || a === b) return false;
    const existing = link ? (this.drawing.links.find((l) => l.id === link) ?? null) : null;
    this.selectedLink = null;
    const ids = new Set([from, to]);
    const applied = await this.runPending(ids, prompt || "Connecting…", async (signal) => {
      const board = this.boardPicture();
      const context = await renderPNG(board.drawing, Theme.light, board.scale, 32, [embedBounds(a), embedBounds(b)]);
      if (!context) return null;
      const result = await connect({ from: a, to: b, link: existing, prompt, context: await base64(context), signal });
      if (signal.aborted) return null;
      return () => {
        if (result.kind === "none") {
          if (result.message) this.toast.show(result.message);
          return;
        }
        if (!this.drawing.embeds.some((e) => e.id === from) || !this.drawing.embeds.some((e) => e.id === to)) {
          this.toast.show("A card was removed while Claude was connecting it.");
          return;
        }
        let drawing: Drawing;
        let id: string;
        const current = existing && this.drawing.links.find((l) => l.id === existing.id);
        if (current) {
          drawing = updatingLink(this.drawing, current.id, { label: result.label, data: result.data });
          id = current.id;
        } else {
          const made = linking(this.drawing, from, to, { label: result.label, data: result.data });
          if (!made) return;
          ({ drawing, id } = made);
        }
        drawing = withUpdates(drawing, result.updates ?? []);
        this.commit(drawing, existing ? "Change Connection" : "Connect");
        if (this.tools.tool === "select") this.selectedLink = id;
      };
    }, "Couldn't connect them.", { from, to });
    if (applied) this.askPrompt.forget();
    else this.askPrompt.remember(prompt);
    return applied;
  }

  /** Removes a link, with whatever the host changes to undo the connection, in one undo step. */
  async deleteLink(id: string): Promise<void> {
    const link = this.drawing.links.find((l) => l.id === id);
    if (!link) return;
    if (this.selectedLink === id) this.selectedLink = null;
    const disconnect = this.options.disconnect;
    if (!disconnect) {
      this.commit(removing(this.drawing, new Set([id])), "Disconnect");
      return;
    }
    await this.runPending(new Set([link.from, link.to]), "Disconnecting…", async (signal) => {
      const updates = await disconnect(link, signal);
      return () => {
        if (!this.drawing.links.some((l) => l.id === id)) return;
        this.commit(withUpdates(removing(this.drawing, new Set([id])), updates), "Disconnect");
      };
    }, "Couldn't disconnect them.", { from: link.from, to: link.to });
  }

  /** The whole board for Claude, and a scale that keeps the picture about 1600 px on its long side. */
  private boardPicture(): { drawing: Drawing; scale: number } {
    const drawing = { ...emptyDrawing("plain"), strokes: this.drawing.strokes, math: this.drawing.math, embeds: this.drawing.embeds, links: this.drawing.links };
    const all = contentBounds(drawing) ?? { x: 0, y: 0, w: 1, h: 1 };
    return { drawing, scale: Math.min(1.5, Math.max(0.25, 1600 / Math.max(all.w, all.h, 1))) };
  }

  /** Opens the Ask prompt for the selection. Needs an `ask` option. */
  openAsk(): void {
    const link = this.getSelectedLink();
    if (link) return this.openConnect(link.from, link.to, link.id);
    if (!this.options.ask || this.selection.size === 0) return;
    const bounds = this.selectionBounds;
    if (!bounds) return;
    const embeds = this.selectedEmbeds;
    // One thing is replaced at a time: handwriting becomes a card, or a card changes. The rest of
    // the board goes along as context, so arrows from other cards don't need selecting.
    if (embeds.length > 1) {
      this.toast.show("Select one card to change, or some handwriting to turn into a card. Claude sees the rest of the board.");
      return;
    }
    const label = embeds.length === 1 ? `How should “${embeds[0].title || embeds[0].ref}” change?` : "What should this become?";
    this.menu.close();
    this.closeEditor();
    this.askPrompt.open(label, this.viewport.rectToView(bounds));
    this.requestRender();
  }

  private closeAsk(): void {
    this.connecting = null;
    if (!this.askPrompt.isOpen) return;
    this.askPrompt.close();
    this.root.focus({ preventScroll: true });
    this.requestRender();
  }

  /**
   * Asks the host (and so, Claude) to turn the selection into an embed, or to change the selected
   * embed. The selection shows marching ants meanwhile; the board stays usable.
   */
  async ask(prompt: string): Promise<void> {
    const ask = this.options.ask;
    if (!ask) {
      this.toast.show("Asking Claude needs a host that can run it.");
      return;
    }
    const ids = new Set(this.selection);
    if (ids.size === 0) return;
    const frag = fragmentOf(this.drawing, ids);
    if (frag.embeds.length > 1) return;
    const bounds = boundsOfIDs(this.drawing, ids)!;
    const ink = contentBounds({ strokes: frag.strokes, math: frag.math }) ?? bounds;
    // Changing one card keeps its size; anything new is sized like the handwriting.
    const card = frag.embeds.length === 1 ? frag.embeds[0] : null;
    const size = card
      ? { w: Math.round(card.size.w), h: Math.round(card.size.h - EMBED_HEADER) }
      : { w: Math.round(Math.min(960, Math.max(320, ink.w))), h: Math.round(Math.min(800, Math.max(200, ink.h))) };
    const applied = await this.runPending(ids, prompt || "Reading the sketch…", async (signal) => {
      const scale = Math.min(2, Math.max(0.5, 1600 / Math.max(bounds.w, bounds.h, 1)));
      const png = await renderPNG({ ...emptyDrawing("plain"), ...frag }, Theme.light, scale, 24);
      if (!png) return null;
      // The whole board, the selection outlined: what's around it (an arrow from a card, say).
      const board = this.boardPicture();
      const context = await renderPNG(board.drawing, Theme.light, board.scale, 32, bounds);
      if (!context) return null;
      const result = await ask({
        prompt, png: await base64(png), context: await base64(context), arrows: arrowLinks(this.drawing, ids), bounds, size,
        strokes: frag.strokes, math: frag.math, embeds: frag.embeds, signal,
      });
      if (signal.aborted) return null;
      return () => {
        const strokeIDs = new Set(frag.strokes.map((s) => s.id));
        const updates = result.kind === "none" ? [] : result.updates ?? [];
        switch (result.kind) {
          case "none":
            if (result.message) this.toast.show(result.message);
            return;
          case "insert": {
            // A new card goes where the handwriting was; with no handwriting, next to the selection.
            const origin = frag.strokes.length > 0 || frag.math.length > 0 ? { x: ink.x, y: ink.y } : { x: bounds.x + bounds.w + 32, y: bounds.y };
            const { drawing, id } = embedding(this.drawing, strokeIDs, origin, size, {
              ref: result.ref, title: result.title, data: result.data,
            });
            if (this.tools.tool === "select") this.selection = new Set([id]);
            this.commit(withUpdates(drawing, updates), "Ask Claude");
            return;
          }
          case "update": {
            if (!this.drawing.embeds.some((e) => e.id === result.id)) {
              this.toast.show("That item was removed while Claude was working on it.");
              return;
            }
            const patch: Partial<EmbedContent> = {};
            if (result.ref !== undefined) patch.ref = result.ref;
            if (result.title !== undefined) patch.title = result.title;
            if (result.data !== undefined) patch.data = result.data;
            if (this.tools.tool === "select") this.selection = new Set([result.id]);
            this.commit(withUpdates(refiningEmbed(this.drawing, result.id, strokeIDs, patch), updates), "Refine with Claude");
            return;
          }
        }
      };
    });
    // A prompt that didn't get through is offered again; one that did isn't.
    if (applied) this.askPrompt.forget();
    else this.askPrompt.remember(prompt);
  }

  /** Cancels the most recent request still waiting on Claude. Returns whether there was one. */
  cancelPending(): boolean {
    const last = [...this.pending.entries()].reverse().find(([, p]) => p.abort);
    if (!last) return false;
    last[1].abort!.abort();
    this.pending.delete(last[0]);
    this.toast.show("Cancelled.", 1500);
    this.requestRender();
    return true;
  }

  // MARK: Math

  private get selectedStrokeIDs(): Set<string> {
    return new Set(this.drawing.strokes.filter((s) => this.selection.has(s.id)).map((s) => s.id));
  }

  private get selectedMath(): MathItem[] {
    return this.drawing.math.filter((m) => this.selection.has(m.id));
  }

  private get selectedEmbeds(): EmbedItem[] {
    return this.drawing.embeds.filter((e) => this.selection.has(e.id));
  }

  /** Whether anything (Convert to LaTeX, Ask) is waiting on Claude. */
  get isConverting(): boolean {
    return this.pending.size > 0;
  }

  /** Sends the selected handwriting to Claude and replaces it with typeset math. */
  async convertToLatex(): Promise<void> {
    const ids = this.selectedStrokeIDs;
    if (ids.size === 0) return;
    const recognize = this.options.recognize;
    if (!recognize) {
      this.toast.show(new RecognizerError("unavailable").message);
      return;
    }
    const strokes = this.drawing.strokes.filter((s) => ids.has(s.id));
    await this.runPending(ids, null, async () => {
      const content = contentBounds({ strokes, math: [] })!;
      // Plain light paper, about 1600 px on the long side.
      const scale = Math.min(2, Math.max(0.5, 1600 / Math.max(content.w, content.h, 1)));
      const png = await renderPNG({ ...emptyDrawing("plain"), strokes }, Theme.light, scale, 24);
      if (!png) return null;
      const latex = await recognizeLatex(await base64(png), recognize, isValidLatex);
      return () => {
        const { fontSize, frame } = fitMath(latex, boundsOfIDs(this.drawing, ids)!);
        const result = converting(this.drawing, ids, latex, fontSize, frame);
        if (!result) return;
        if (this.tools.tool === "select") this.selection = new Set([result.id]);
        this.commit(result.drawing, "Convert to LaTeX");
      };
    }, "Couldn't convert to LaTeX.");
  }

  /**
   * Runs a request to Claude about some items: they get marching ants and can't be sent again
   * until it's done. `work` returns how to apply the answer, which only happens if every stroke
   * involved is still there. Returns whether it was applied.
   */
  private async runPending(
    ids: Set<string>, label: string | null, work: (signal: AbortSignal) => Promise<(() => void) | null>,
    failure = "Couldn't ask Claude.", wire?: { from: string; to: string },
  ): Promise<boolean> {
    if ([...this.pending.values()].some((p) => [...ids].some((id) => p.ids.has(id)))) {
      if (wire) this.toast.show("Claude is still working on one of these cards.");
      return false;
    }
    const strokeIDs = new Set(this.drawing.strokes.filter((s) => ids.has(s.id)).map((s) => s.id));
    const key = newID();
    const abort = label === null ? null : new AbortController();
    this.pending.set(key, { ids, label, abort, wire });
    this.selection.clear();
    this.animatePending();
    this.toolsChanged();
    const signal = abort?.signal ?? new AbortController().signal;
    // Stop waiting as soon as it's cancelled, whether or not the host listens to the signal.
    const cancelled = new Promise<null>((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true }));
    try {
      const apply = await Promise.race([work(signal), cancelled]);
      if (!apply || signal.aborted) return false;
      // Erased while Claude was reading it: leave the rest alone.
      if (this.drawing.strokes.filter((s) => strokeIDs.has(s.id)).length !== strokeIDs.size) {
        this.toast.show("Some of the handwriting was erased while Claude read it, so nothing changed.");
        return false;
      }
      apply();
      return true;
    } catch (error) {
      if (abort?.signal.aborted) return false;
      this.toast.show(`${failure} ${error instanceof Error ? error.message : String(error)}`.trim());
      return false;
    } finally {
      this.pending.delete(key);
      this.requestRender();
    }
  }

  /** Opens the LaTeX editor for the selected math item (or `id`). */
  editLatex(id?: string): void {
    const item = id ? this.drawing.math.find((m) => m.id === id) : this.selectedMath.length === 1 ? this.selectedMath[0] : null;
    if (!item) return;
    this.selection = new Set([item.id]);
    this.menu.close();
    this.editor.open(item.id, item.latex, this.viewport.rectToView(mathBounds(item)), this.theme, this.theme.mathColor(item));
    this.requestRender();
  }

  private commitLatexEdit(text: string): void {
    const id = this.editor.id;
    this.closeEditor();
    const item = this.drawing.math.find((m) => m.id === id);
    const latex = text.trim();
    if (!item || !latex || latex === item.latex) return;
    this.commit(editingLatex(this.drawing, item.id, latex, layoutSize(latex, item.fontSize)), "Edit LaTeX");
  }

  private closeEditor(): void {
    if (!this.editor.isOpen) return;
    this.editor.close();
    this.root.focus({ preventScroll: true });
  }

  /** Puts converted math and embeds back as the handwriting they came from. */
  revertToInk(): void {
    let drawing = this.drawing;
    const restored = new Set<string>();
    for (const item of this.selectedMath) {
      const r = revertingToInk(drawing, item.id);
      if (!r) continue;
      drawing = r.drawing;
      for (const id of r.ids) restored.add(id);
    }
    for (const item of this.selectedEmbeds) {
      const r = revertingEmbedToInk(drawing, item.id);
      if (!r) continue;
      drawing = r.drawing;
      for (const id of r.ids) restored.add(id);
    }
    if (restored.size === 0) return;
    this.selection = restored;
    this.commit(drawing, "Revert to Ink");
  }

  /** Copies the selected items' LaTeX source, one per line. */
  copyLatex(): void {
    const latex = this.selectedMath.map((m) => m.latex).join("\n");
    if (!latex) return;
    navigator.clipboard?.writeText(latex).then(
      () => this.toast.show("LaTeX copied", 1800),
      () => this.toast.show("Couldn't copy to the clipboard."),
    );
  }

  private animatePending(): void {
    if (this.pendingFrame) return;
    const tick = () => {
      this.pendingFrame = this.pending.size > 0 ? requestAnimationFrame(tick) : 0;
      this.render();
    };
    this.pendingFrame = requestAnimationFrame(tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.pendingFrame);
    for (const p of this.pending.values()) p.abort?.abort();
    this.embeds.destroy();
    for (const cleanup of this.cleanups) cleanup();
    this.root.remove();
  }

  // MARK: State helpers

  private get viewCenter(): Point {
    return { x: this.size.w / 2, y: this.size.h / 2 };
  }

  private get visibleStrokes(): Stroke[] {
    return this.showsInk ? this.drawing.strokes : [];
  }

  private get visibleMath(): MathItem[] {
    return this.showsMath ? this.drawing.math : [];
  }

  /** Everything the lasso, Select All and the eraser can reach. Embeds are always shown. */
  private get selectableIDs(): Set<string> {
    return new Set([
      ...this.visibleStrokes.map((s) => s.id), ...this.visibleMath.map((m) => m.id), ...this.drawing.embeds.map((e) => e.id),
    ]);
  }

  private get selectionBounds(): Rect | null {
    return boundsOfIDs(this.drawing, this.selection);
  }

  private get exportDrawing(): Drawing {
    if (this.selection.size === 0) return this.drawing;
    return { ...this.drawing, ...fragmentOf(this.drawing, this.selection) };
  }

  private resolveTheme(): Theme {
    return Theme.of(this.appearance === "system" ? systemIsDark() : this.appearance === "dark");
  }

  private themeChanged(): void {
    const theme = this.resolveTheme();
    if (theme === this.theme) return;
    this.theme = theme;
    this.toolsChanged();
  }

  /** Records an edit for undo and tells the host. */
  private commit(next: Drawing, name: string): void {
    this.history.push(this.drawing, name);
    this.drawing = next;
    this.pruneSelection();
    this.toolsChanged();
    this.options.onChange?.(next, name);
  }

  private applyHistory(drawing: Drawing, name: string): void {
    this.cancelGesture();
    this.drawing = drawing;
    this.pruneSelection();
    this.toolsChanged();
    this.options.onChange?.(drawing, name);
  }

  /** Hidden or deleted things can't stay selected. */
  private pruneSelection(): void {
    if (this.selectedLink && !this.drawing.links.some((l) => l.id === this.selectedLink)) this.selectedLink = null;
    if (this.selection.size === 0) return;
    const available = this.selectableIDs;
    for (const id of this.selection) if (!available.has(id)) this.selection.delete(id);
  }

  /** Refreshes everything that depends on tools, theme or selection. */
  private toolsChanged(): void {
    this.root.classList.toggle("sk-dark", this.theme.isDark);
    this.root.dataset.tool = this.tools.tool;
    this.palette.update({
      tool: this.tools.tool,
      widthIndex: this.tools.widthIndex,
      swatch: this.tools.swatch,
      theme: this.theme,
      background: this.drawing.background,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
    });
    this.requestRender();
  }

  // MARK: Events

  private listen(): void {
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    on(this.canvas, "pointerdown", (e) => this.pointerDown(e));
    on(this.canvas, "pointermove", (e) => this.pointerMove(e));
    on(this.canvas, "pointerup", (e) => this.pointerUp(e));
    on(this.canvas, "pointercancel", (e) => this.pointerCancel(e));
    on(this.canvas, "pointerleave", () => {
      if (this.gesture) return;
      this.hover = null;
      if (this.hoveredCard || this.hoveredLink) {
        this.hoveredCard = this.hoveredLink = null;
        this.requestRender();
      }
    });
    on(this.canvas, "wheel", (e) => this.wheel(e), { passive: false });
    on(this.canvas, "contextmenu", (e) => this.contextMenu(e));
    on(this.root, "keydown", (e) => this.keyDown(e));
    on(this.root, "keyup", (e) => this.keyUp(e));
    on(this.root, "blur", () => {
      this.spaceDown = false;
      this.requestRender();
    });
    // Safari's trackpad pinch arrives as gesture events; the wheel handler covers the rest.
    on(this.root, "gesturestart" as keyof HTMLElementEventMap, (e) => e.preventDefault());

    // Clipboard events go to the document; act on them only while the board has focus.
    const clip = (type: "copy" | "cut" | "paste") => (e: ClipboardEvent) => {
      if (!this.hasFocus) return;
      e.preventDefault();
      this.pendingClipboard = null;
      if (type === "paste") this.paste(e.clipboardData);
      else this.copy(type, e.clipboardData);
    };
    for (const type of ["copy", "cut", "paste"] as const) {
      const fn = clip(type);
      document.addEventListener(type, fn);
      this.cleanups.push(() => document.removeEventListener(type, fn));
    }

    const resize = new ResizeObserver(() => this.resized());
    resize.observe(this.root);
    this.cleanups.push(() => resize.disconnect());
    this.cleanups.push(watchSystemAppearance(() => this.themeChanged()));
    this.cleanups.push(onMathImageLoad(() => this.requestRender()));
  }

  private get hasFocus(): boolean {
    const active = (this.root.getRootNode() as Document | ShadowRoot).activeElement;
    return !!active && this.root.contains(active);
  }

  private resized(): void {
    const w = this.root.clientWidth, hgt = this.root.clientHeight;
    if (w === this.size.w && hgt === this.size.h) return;
    this.size = { w, h: hgt };
    if (!this.didInitialFit && w > 0 && hgt > 0) {
      this.didInitialFit = true;
      if (!isEmpty(this.drawing)) this.viewport = Viewport.fitting(contentBounds(this.drawing), this.size);
    }
    this.render();
  }

  private viewPoint(e: MouseEvent): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pointerDown(e: PointerEvent): void {
    this.menu.close();
    this.closeEditor();
    this.closeAsk();
    this.embeds.deactivate();
    this.root.focus({ preventScroll: true });
    const v = this.viewPoint(e);
    this.hover = v;

    if (e.pointerType === "touch") {
      this.touches.set(e.pointerId, v);
      if (this.touches.size === 2) {
        // A second finger turns whatever the first one started into pan/zoom.
        this.cancelGesture();
        this.gesture = { kind: "pinch", last: this.pinchState() };
        return;
      }
      if (this.touches.size > 2) return;
    }
    if (this.gesture) return;
    if (e.button === 2) return; // the context menu handles right-clicks
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers (tests) can't be captured.
    }

    if (e.button === 1 || this.spaceDown) {
      this.gesture = { kind: "pan", pointerId: e.pointerId, last: v };
      e.preventDefault();
      this.requestRender();
      return;
    }
    if (e.button !== 0) return;

    const p = this.viewport.toCanvas(v);
    // A pen's eraser end reports the eraser button.
    const tool = e.pointerType === "pen" && e.buttons & 32 ? "eraser" : this.tools.tool;
    switch (tool) {
      case "pen":
      case "marker":
        this.gesture = {
          kind: "stroke",
          pointerId: e.pointerId,
          stroke: {
            id: newID(),
            tool,
            color: this.theme.palette[this.tools.swatch],
            swatch: this.tools.swatch,
            width: this.tools.screenWidth / this.viewport.scale,
            points: [p],
          },
        };
        break;
      case "eraser":
        this.erased = new Set();
        this.gesture = { kind: "erase", pointerId: e.pointerId, last: p };
        this.erase(p, p);
        break;
      case "connect": {
        const card = embedAt(p, this.drawing.embeds, 4 / this.viewport.scale);
        if (!card) {
          this.toast.show("Start the wire on a card, and drop it on another.", 2500);
          break;
        }
        this.gesture = { kind: "connect", pointerId: e.pointerId, from: card.id, to: null, point: p };
        break;
      }
      case "select": {
        const now = performance.now();
        const double = !!this.lastDown && now - this.lastDown.time < DOUBLE_CLICK_MS && distance(this.lastDown.p, v) < 5;
        this.lastDown = double ? null : { time: now, p: v };
        this.selectDown(e.pointerId, p, double);
        break;
      }
    }
    this.requestRender();
  }

  private pointerMove(e: PointerEvent): void {
    const v = this.viewPoint(e);
    this.hover = v;
    const g = this.gesture;
    if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, v);
      if (g?.kind === "pinch") {
        const next = this.pinchState();
        let vp = this.viewport.panned(next.center.x - g.last.center.x, next.center.y - g.last.center.y);
        if (g.last.spread > 0 && next.spread > 0) vp = vp.zoomed(next.spread / g.last.spread, next.center);
        this.viewport = vp;
        g.last = next;
        this.requestRender();
        return;
      }
    }
    if (!g) {
      this.updateHover(this.viewport.toCanvas(v));
      this.updateCursor();
      return;
    }
    if (g.kind === "pinch" || g.pointerId !== e.pointerId) return;

    if (g.kind === "pan") {
      this.viewport = this.viewport.panned(v.x - g.last.x, v.y - g.last.y);
      g.last = v;
      this.requestRender();
      return;
    }
    // Every sample counts for ink; browsers otherwise deliver one move per frame.
    const samples = e.getCoalescedEvents?.() ?? [];
    const points = (samples.length > 0 ? samples : [e]).map((s) => this.viewport.toCanvas(this.viewPoint(s)));
    const spacing = MIN_POINT_SPACING / this.viewport.scale;
    for (const p of points) {
      switch (g.kind) {
        case "stroke": {
          const pts = g.stroke.points;
          if (distance(pts[pts.length - 1], p) >= spacing) pts.push(p);
          break;
        }
        case "erase":
          this.erase(g.last, p);
          g.last = p;
          break;
        case "lasso": {
          if (distance(g.points[g.points.length - 1], p) >= spacing) g.points.push(p);
          break;
        }
        case "scale": {
          // Project the pointer onto the diagonal so the scale stays uniform.
          const dx = g.start.x - g.anchor.x, dy = g.start.y - g.anchor.y;
          const lengthSq = dx * dx + dy * dy;
          if (lengthSq > 0) {
            const t = ((p.x - g.anchor.x) * dx + (p.y - g.anchor.y) * dy) / lengthSq;
            g.factor = Math.max(0.05, Math.min(20, t));
          }
          break;
        }
        case "move":
          g.offset = { x: p.x - g.anchor.x, y: p.y - g.anchor.y };
          break;
        case "connect": {
          g.point = p;
          const card = embedAt(p, this.drawing.embeds, 4 / this.viewport.scale);
          g.to = card && card.id !== g.from ? card.id : null;
          break;
        }
      }
    }
    this.requestRender();
  }

  private pointerUp(e: PointerEvent): void {
    if (e.pointerType === "touch") {
      this.touches.delete(e.pointerId);
      if (this.gesture?.kind === "pinch") {
        if (this.touches.size < 2) this.gesture = null;
        return;
      }
    }
    const g = this.gesture;
    if (!g || g.kind === "pinch" || g.pointerId !== e.pointerId) return;
    this.gesture = null;
    const p = this.viewport.toCanvas(this.viewPoint(e));

    switch (g.kind) {
      case "pan":
        break;
      case "stroke": {
        const pts = g.stroke.points;
        const last = pts[pts.length - 1];
        if (last.x !== p.x || last.y !== p.y) pts.push(p);
        this.commit(
          { ...this.drawing, strokes: [...this.drawing.strokes, g.stroke] },
          g.stroke.tool === "marker" ? "Marker Stroke" : "Pen Stroke",
        );
        break;
      }
      case "erase": {
        const ids = this.erased;
        this.erased = new Set();
        if (ids.size > 0) this.commit(removing(this.drawing, ids), "Erase");
        break;
      }
      case "lasso": {
        const box = boundsOf(g.points)!;
        // A click (not a drag) just clears the selection.
        if (Math.max(box.w, box.h) * this.viewport.scale > 4) {
          this.selection = new Set([
            ...strokesInLasso(g.points, this.visibleStrokes),
            ...mathItemsInLasso(g.points, this.visibleMath),
            ...embedsInLasso(g.points, this.drawing.embeds),
          ]);
        }
        break;
      }
      case "move":
        if (Math.hypot(g.offset.x, g.offset.y) > 0.01) {
          this.commit(translating(this.drawing, this.selection, { dx: g.offset.x, dy: g.offset.y }), "Move");
        }
        break;
      case "scale":
        if (Math.abs(g.factor - 1) > 0.001) {
          this.commit(scaling(this.drawing, this.selection, g.factor, g.anchor), "Resize");
        }
        break;
      case "connect":
        if (g.to) this.openConnect(g.from, g.to);
        else if (!embedAt(p, this.drawing.embeds, 4 / this.viewport.scale)) {
          this.toast.show("Drop the wire on another card to connect them.", 2500);
        }
        break;
    }
    this.requestRender();
  }

  private pointerCancel(e: PointerEvent): void {
    this.touches.delete(e.pointerId);
    if (this.gesture?.kind === "pinch" && this.touches.size < 2) this.gesture = null;
    else if (this.gesture && this.gesture.kind !== "pinch" && this.gesture.pointerId === e.pointerId) {
      this.cancelGesture();
    }
  }

  private pinchState(): { center: Point; spread: number } {
    const [a, b] = [...this.touches.values()];
    return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, spread: distance(a, b) };
  }

  /** Drops an in-progress gesture without committing it (Esc, a second finger, a cancelled pointer). */
  private cancelGesture(): void {
    this.gesture = null;
    this.erased = new Set();
    this.requestRender();
  }

  private erase(a: Point, b: Point): void {
    const radius = ERASER_RADIUS / this.viewport.scale;
    const strokes = this.visibleStrokes.filter((s) => !this.erased.has(s.id));
    const math = this.visibleMath.filter((m) => !this.erased.has(m.id));
    for (const id of strokesTouched(strokes, a, b, radius)) this.erased.add(id);
    for (const id of mathItemsTouched(math, a, b, radius)) this.erased.add(id);
  }

  // MARK: Wires

  /**
   * Every wire there is: links (checked against the host's dependencies), dependencies without a
   * link (ghosts), connections being made, and the one being dragged. `frameOf` gives each card's
   * frame, following a move or resize in progress.
   */
  private drawnWires(frameOf: (e: EmbedItem) => Rect = embedBounds): DrawnWire[] {
    const byID = new Map(this.drawing.embeds.map((e) => [e.id, e]));
    const byRef = new Map(this.drawing.embeds.map((e) => [e.ref, e]));
    const making = [...this.pending.values()].flatMap((p) => (p.wire ? [p.wire] : []));
    const isMaking = (from: string, to: string) => making.some((w) => w.from === from && w.to === to);
    const host = this.hostWires;
    const matched = new Set<Wire>();
    const out: DrawnWire[] = [];
    const add = (a: EmbedItem, b: EmbedItem, rest: Omit<DrawnWire, "curve" | "from" | "to">) =>
      out.push({ ...rest, from: a.id, to: b.id, curve: wireCurve(frameOf(a), frameOf(b)) });
    for (const link of this.drawing.links) {
      const a = byID.get(link.from), b = byID.get(link.to);
      if (!a || !b) continue;
      const wire = host?.find((w) => w.from === a.ref && w.to === b.ref);
      if (wire) matched.add(wire);
      // A link made or changed since the host last reported isn't judged until it reports again.
      const unchecked = !host || this.checkedLinks.get(link.id) !== link;
      const state = isMaking(a.id, b.id) ? "pending" : wire || unchecked ? "linked" : "broken";
      add(a, b, { key: link.id, label: wire?.label || link.label, state, link });
    }
    for (const wire of host ?? []) {
      if (matched.has(wire)) continue;
      const a = byRef.get(wire.from), b = byRef.get(wire.to);
      if (!a || !b || a === b) continue;
      add(a, b, { key: `ghost:${a.id}:${b.id}`, label: wire.label, state: isMaking(a.id, b.id) ? "pending" : "ghost", link: null });
    }
    const has = (from: string, to: string) => out.some((w) => w.from === from && w.to === to);
    for (const w of making) {
      const a = byID.get(w.from), b = byID.get(w.to);
      if (a && b && !has(a.id, b.id)) add(a, b, { key: `making:${a.id}:${b.id}`, label: "", state: "pending", link: null });
    }
    const c = this.connecting;
    if (c && !c.link) {
      const a = byID.get(c.from), b = byID.get(c.to);
      if (a && b && !has(a.id, b.id)) add(a, b, { key: "dragging", label: "", state: "dragging", link: null });
    }
    const g = this.gesture;
    if (g?.kind === "connect") {
      const a = byID.get(g.from), b = g.to ? byID.get(g.to) : undefined;
      if (a) {
        out.push({
          key: "dragging", from: a.id, to: b?.id ?? "", label: "", state: "dragging", link: null,
          curve: wireCurve(frameOf(a), b ? frameOf(b) : g.point),
        });
      }
    }
    return out;
  }

  /**
   * Wires show while they're being made, while the Connect tool is on, and otherwise only for the
   * cards (or link) under the pointer or selected, to keep the board clean.
   */
  private wireVisible(w: DrawnWire): boolean {
    if (w.state === "pending" || w.state === "dragging" || this.tools.tool === "connect") return true;
    if (w.link && (w.link.id === this.selectedLink || w.link.id === this.hoveredLink)) return true;
    for (const id of [this.hoveredEmbed, this.hoveredCard, ...this.selectedEmbeds.map((e) => e.id)]) {
      if (id && (w.from === id || w.to === id)) return true;
    }
    return false;
  }

  /** The link wire near `p` (canvas coordinates), if any; with `visibleOnly`, only showing ones. */
  private wireAt(p: Point, { visibleOnly = false } = {}): DrawnWire | null {
    const wires = this.drawnWires().filter((w) => w.link && (!visibleOnly || this.wireVisible(w)));
    if (wires.length === 0) return null;
    return nearestWire(p, wires, 6 / this.viewport.scale, this.drawing.embeds.map(embedBounds));
  }

  /** Tracks the card and link under the pointer, whose wires show. */
  private updateHover(p: Point): void {
    const card = embedAt(p, this.drawing.embeds, 4 / this.viewport.scale)?.id ?? null;
    const link = card ? null : (this.wireAt(p)?.link?.id ?? null);
    if (card === this.hoveredCard && link === this.hoveredLink) return;
    this.hoveredCard = card;
    this.hoveredLink = link;
    this.requestRender();
  }

  private drawWires(ctx: CanvasRenderingContext2D, wires: readonly DrawnWire[], px: number): void {
    const phase = -performance.now() * 0.018;
    const theme = this.theme;
    for (const w of wires) {
      if (!this.wireVisible(w)) continue;
      const selected = !!w.link && w.link.id === this.selectedLink;
      const hovered = !!w.link && w.link.id === this.hoveredLink;
      const base = { px, paper: theme.paper, label: w.label || undefined };
      switch (w.state) {
        case "linked":
          drawWire(ctx, w.curve, { ...base, color: ACCENT, width: (selected ? 3 : hovered ? 2.5 : 2) * px });
          break;
        case "ghost":
          drawWire(ctx, w.curve, { ...base, color: { ...theme.palette[1], a: 0.8 }, width: 1.5 * px, dash: [5 * px, 4 * px] });
          break;
        case "broken":
          drawWire(ctx, w.curve, {
            ...base, color: theme.palette[3], width: (selected ? 3 : 2) * px, dash: [6 * px, 4 * px],
            label: `${w.label ? `${w.label} · ` : ""}not connected`,
          });
          break;
        case "pending":
          drawWire(ctx, w.curve, { ...base, color: ACCENT, width: 2 * px, dash: [6 * px, 4 * px], dashOffset: phase * px });
          break;
        case "dragging":
          drawWire(ctx, w.curve, { ...base, color: ACCENT, width: 2 * px, dash: [6 * px, 4 * px] });
          break;
      }
    }
    // The cards at either end of a wire being dragged.
    const g = this.gesture;
    if (g?.kind === "connect") {
      ctx.save();
      ctx.strokeStyle = css(ACCENT, 0.9);
      ctx.lineWidth = 2 * px;
      for (const id of [g.from, g.to]) {
        const e = id && this.drawing.embeds.find((x) => x.id === id);
        if (!e) continue;
        const r = embedBounds(e);
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, 10 * e.scale);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // MARK: Select tool

  private get resizeHandleCenter(): Point | null {
    const bounds = this.selectionBounds;
    if (!bounds || this.tools.tool !== "select") return null;
    const r = outset(this.viewport.rectToView(applyRect(bounds, this.previewTransform)), 6);
    return { x: r.x + r.w, y: r.y + r.h };
  }

  private selectDown(pointerId: number, p: Point, double: boolean): void {
    const slack = 4 / this.viewport.scale;
    const handle = this.resizeHandleCenter;
    if (handle && distance(this.viewport.toView(p), handle) <= RESIZE_HANDLE_RADIUS + 6) {
      const b = this.selectionBounds!;
      if (b.w > 0 || b.h > 0) {
        this.gesture = { kind: "scale", pointerId, anchor: { x: b.x, y: b.y }, start: p, factor: 1 };
        return;
      }
    }
    // Wires that are showing can be picked up between the cards.
    const wire = this.wireAt(p, { visibleOnly: true });
    if (wire?.link) {
      this.selection = new Set();
      this.selectedLink = wire.link.id;
      if (double) this.options.onLinkOpen?.(wire.link);
      return;
    }
    this.selectedLink = null;
    // Cards are on top of math. With the select tool their content takes its own clicks, so
    // what reaches the canvas is the header (or the edge, within the slack).
    const card = embedAt(p, this.drawing.embeds, slack);
    if (card && double) {
      const item = this.drawing.embeds.find((e) => e.id === card.id)!;
      this.selection = new Set([item.id]);
      this.options.onEmbedOpen?.(item);
      return;
    }
    const hit = card?.id ?? mathItemAt(p, this.visibleMath, slack);
    if (double && hit) {
      this.editLatex(hit);
      return;
    }
    const bounds = this.selectionBounds;
    if (bounds && this.selection.size > 0 && contains(outset(bounds, 8 / this.viewport.scale), p)) {
      this.gesture = { kind: "move", pointerId, anchor: p, offset: { x: 0, y: 0 } };
      return;
    }
    // Math items can be grabbed directly, without lassoing them first.
    if (hit) {
      this.selection = new Set([hit]);
      this.gesture = { kind: "move", pointerId, anchor: p, offset: { x: 0, y: 0 } };
      return;
    }
    this.selection = new Set();
    this.gesture = { kind: "lasso", pointerId, points: [p] };
  }

  private get previewTransform(): Affine {
    const g = this.gesture;
    if (g?.kind === "move") return { s: 1, tx: g.offset.x, ty: g.offset.y };
    if (g?.kind === "scale") return { s: g.factor, tx: g.anchor.x * (1 - g.factor), ty: g.anchor.y * (1 - g.factor) };
    return IDENTITY;
  }

  private copy(kind: "copy" | "cut", data: DataTransfer | null): void {
    if (this.selection.size === 0) return;
    const fragment = fragmentOf(this.drawing, this.selection);
    // Math on its own also goes out as LaTeX text, for pasting into papers and notebooks.
    const mathOnly = fragment.strokes.length === 0 && fragment.embeds.length === 0;
    const text = mathOnly ? fragment.math.map((m) => m.latex).join("\n") : undefined;
    writeFragment(fragment, data, text);
    if (kind === "cut") {
      const next = removing(this.drawing, this.selection);
      this.selection.clear();
      this.commit(next, "Cut");
    }
  }

  private paste(data: DataTransfer | null): void {
    const fragment = readFragment(data);
    if (!fragment || (fragment.strokes.length === 0 && fragment.math.length === 0 && fragment.embeds.length === 0)) return;
    const bounds = contentBounds(fragment);
    // Paste under the pointer if it is over the canvas, else just next to the original.
    let offset = { dx: 16 / this.viewport.scale, dy: 16 / this.viewport.scale };
    if (this.hover && bounds) {
      const target = this.viewport.toCanvas(this.hover);
      const c = center(bounds);
      offset = { dx: target.x - c.x, dy: target.y - c.y };
    }
    const { drawing, ids } = inserting(this.drawing, fragment, offset);
    this.tools.tool = "select";
    this.selection = ids;
    this.commit(drawing, "Paste");
  }

  // MARK: Wheel, keys, menu

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.menu.close();
    const v = this.viewPoint(e);
    const lines = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 400 : 1;
    // Trackpad pinches arrive as ctrl+wheel; ⌘-scroll zooms too.
    if (e.ctrlKey || e.metaKey) {
      this.viewport = this.viewport.zoomed(Math.exp(-e.deltaY * lines * 0.01), v);
    } else {
      this.viewport = this.viewport.panned(-e.deltaX * lines, -e.deltaY * lines);
    }
    this.requestRender();
  }

  private keyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable]")) return;
    // Keep notebook and page shortcuts (m, e, a, …) away while the board has focus.
    e.stopPropagation();
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && e.altKey && e.code === "KeyC") {
      e.preventDefault();
      this.copyLatex();
      return;
    }
    if (mod) {
      const handled = this.modKey(key, e);
      if (handled) e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    if (e.key === "Escape") {
      if (this.menu.isOpen) this.menu.close();
      else if (this.gesture && this.gesture.kind !== "pan" && this.gesture.kind !== "pinch") this.cancelGesture();
      else if (this.selectedLink) {
        this.selectedLink = null;
        this.requestRender();
      } else if (this.selection.size > 0) {
        this.selection.clear();
        this.requestRender();
      } else this.cancelPending();
      return;
    }
    if (e.key === "Enter") {
      if (this.selectedLink && this.options.connect) {
        e.preventDefault();
        this.openAsk();
      } else if (this.selectedMath.length === 1 && this.selection.size === 1) {
        e.preventDefault();
        this.editLatex();
      } else if (this.selectedEmbeds.length === 1 && this.options.ask) {
        e.preventDefault();
        this.openAsk();
      }
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      if (this.selection.size > 0 || this.selectedLink) {
        e.preventDefault();
        this.deleteSelection();
      }
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) {
        this.spaceDown = true;
        this.updateCursor();
      }
      return;
    }
    // Shift+0 stands in for ⌘1, which browsers keep for switching tabs.
    if (e.shiftKey && e.code === "Digit0") return this.zoomToActualSize();
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (digit) return this.selectSwatch(Number(digit[1]) - 1);
    switch (key) {
      case "p":
      case "b":
        return this.setTool("pen");
      case "m":
      case "h":
        return this.setTool("marker");
      case "e":
        return this.setTool("eraser");
      case "s":
        return this.setTool("select");
      case "c":
        return this.setTool("connect");
      case "[":
        this.tools.adjustWidth(-1);
        return this.toolsChanged();
      case "]":
        this.tools.adjustWidth(1);
        return this.toolsChanged();
    }
  }

  /** ⌘ (or Ctrl) shortcuts. Returns whether the key was used. */
  private modKey(key: string, e: KeyboardEvent): boolean {
    switch (key) {
      case "z":
        if (e.shiftKey) this.redo();
        else this.undo();
        return true;
      case "y":
        if (isMac) return false;
        this.redo();
        return true;
      case "a":
        this.selectAll();
        return true;
      case "=":
      case "+":
        this.zoomBy(1.25);
        return true;
      case "-":
      case "_":
        this.zoomBy(0.8);
        return true;
      case "0":
        this.zoomToFit();
        return true;
      case "backspace":
      case "delete":
        if (!e.shiftKey) return false;
        this.clearCanvas();
        return true;
      case "e":
        if (!e.shiftKey) return false;
        void this.exportPNG();
        return true;
      case "s":
        if (!this.options.onSave) return false;
        this.options.onSave(this.drawing);
        return true;
      case "l":
        void this.convertToLatex();
        return true;
      case "k":
        if (!this.options.ask && !(this.selectedLink && this.options.connect)) return false;
        this.openAsk();
        return true;
      case "c":
      case "x":
      case "v":
        if (key === "c" && e.shiftKey) {
          this.copyAsImage();
          return true;
        }
        // Let the browser fire its clipboard event; if it doesn't, use the in-page clipboard.
        this.pendingClipboard = key === "c" ? "copy" : key === "x" ? "cut" : "paste";
        setTimeout(() => {
          const pending = this.pendingClipboard;
          this.pendingClipboard = null;
          if (pending === "paste") this.paste(null);
          else if (pending) this.copy(pending, null);
        });
        return false;
    }
    return false;
  }

  private keyUp(e: KeyboardEvent): void {
    e.stopPropagation();
    if (e.key === " ") {
      this.spaceDown = false;
      this.updateCursor();
    }
  }

  private contextMenu(e: MouseEvent): void {
    e.preventDefault();
    this.cancelGesture();
    const v = this.viewPoint(e);
    const p = this.viewport.toCanvas(v);
    const wire = this.wireAt(p, { visibleOnly: true });
    if (wire?.link) {
      const link = wire.link;
      this.selectLink(link.id);
      this.menu.open(v.x, v.y, [
        ...(this.options.connect
          ? [{ label: "Change Connection…", shortcut: shortcut("K"), action: () => this.openConnect(link.from, link.to, link.id) }]
          : []),
        ...(this.options.onLinkOpen ? [{ label: "Show Code", action: () => this.options.onLinkOpen?.(link) }] : []),
        "separator",
        { label: "Disconnect", shortcut: "⌫", action: () => void this.deleteLink(link.id) },
      ]);
      this.requestRender();
      return;
    }
    this.selectedLink = null;
    const hit = embedAt(p, this.drawing.embeds, 4 / this.viewport.scale)?.id ?? mathItemAt(p, this.visibleMath, 4 / this.viewport.scale);
    if (hit && !this.selection.has(hit)) this.selection = new Set([hit]);
    const empty = isEmpty(this.drawing);
    const math = this.selectedMath;
    const embeds = this.selectedEmbeds;
    const strokes = this.selectedStrokeIDs;
    const mathEntries: MenuEntry[] = [
      ...(this.options.ask ? [{ label: "Ask Claude…", shortcut: shortcut("K"), action: () => this.openAsk() }] : []),
      ...(strokes.size > 0 ? [{ label: "Convert to LaTeX", shortcut: shortcut("L"), action: () => void this.convertToLatex() }] : []),
      ...(math.length === 1 && this.selection.size === 1 ? [{ label: "Edit LaTeX…", shortcut: "↩", action: () => this.editLatex() }] : []),
      ...([...math, ...embeds].some((m) => m.ink.length > 0) ? [{ label: "Revert to Ink", action: () => this.revertToInk() }] : []),
      ...(math.length > 0 ? [{ label: "Copy LaTeX", shortcut: isMac ? "⌥⌘C" : "Ctrl+Alt+C", action: () => this.copyLatex() }] : []),
    ];
    const entries: MenuEntry[] =
      this.selection.size > 0
        ? [
            ...mathEntries,
            ...(mathEntries.length > 0 ? ["separator" as const] : []),
            { label: "Cut", shortcut: shortcut("X"), action: () => this.copy("cut", null) },
            { label: "Copy", shortcut: shortcut("C"), action: () => this.copy("copy", null) },
            { label: "Copy as Image", shortcut: shortcut("C", { shift: true }), action: () => this.copyAsImage() },
            "separator",
            { label: "Delete", shortcut: "⌫", action: () => this.deleteSelection() },
          ]
        : [
            { label: "Paste", shortcut: shortcut("V"), action: () => this.paste(null) },
            { label: "Select All", shortcut: shortcut("A"), disabled: empty, action: () => this.selectAll() },
            "separator",
            { label: "Zoom to Fit", shortcut: shortcut("0"), action: () => this.zoomToFit() },
            { label: "Actual Size", shortcut: shortcut("0", { shift: true, mod: false }), action: () => this.zoomToActualSize() },
            "separator",
            { label: "Copy as Image", shortcut: shortcut("C", { shift: true }), disabled: empty, action: () => this.copyAsImage() },
            { label: "Export as PNG…", shortcut: shortcut("E", { shift: true }), disabled: empty, action: () => void this.exportPNG() },
            "separator",
            { label: "Show Math Layer", checked: this.showsMath, action: () => this.setLayerVisibility({ math: !this.showsMath }) },
            { label: "Show Ink Layer", checked: this.showsInk, action: () => this.setLayerVisibility({ ink: !this.showsInk }) },
            "separator",
            { label: "Clear Canvas", shortcut: shortcut("⌫", { shift: true }), disabled: empty, action: () => this.clearCanvas() },
          ];
    this.menu.open(v.x, v.y, entries);
    this.requestRender();
  }

  // MARK: Rendering

  private requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** Draws the board now. Public so tests can render synchronously. */
  render(): void {
    const { w, h: hgt } = this.size;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(hgt * dpr) || dpr !== this.dpr) {
      this.dpr = dpr;
      for (const c of [this.canvas, this.overlay]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(hgt * dpr);
      }
    }
    const ctx = this.ctx;
    const theme = this.theme;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = css(theme.paper);
    ctx.fillRect(0, 0, w, hgt);
    drawBackground(ctx, this.drawing.background, this.viewport, theme, this.size);

    const vp = this.viewport;
    const toCanvas = [dpr * vp.scale, 0, 0, dpr * vp.scale, dpr * vp.offset.x, dpr * vp.offset.y] as const;
    ctx.setTransform(...toCanvas);
    const visible = vp.rectToCanvas({ x: 0, y: 0, w, h: hgt });
    const preview = this.previewTransform;
    const transforming = preview !== IDENTITY;
    const overlaps = (r: Rect | null) =>
      !!r && r.x <= visible.x + visible.w && visible.x <= r.x + r.w && r.y <= visible.y + visible.h && visible.y <= r.y + r.h;

    // Math layer, underneath.
    for (let item of this.visibleMath) {
      if (this.erased.has(item.id)) continue;
      if (transforming && this.selection.has(item.id)) {
        // Mid move/resize the frame follows the pointer; the font size settles on release.
        const frame = applyRect(mathBounds(item), preview);
        item = { ...item, origin: { x: frame.x, y: frame.y }, size: { w: frame.w, h: frame.h }, fontSize: item.fontSize * preview.s };
      }
      if (overlaps(mathBounds(item))) drawMath(ctx, item, theme);
    }
    const px = 1 / vp.scale;
    const ink = this.inkItems(preview, overlaps);
    this.drawInkPass(ctx, ink, px);

    // Embedded cards (DOM) cover the canvas. Ink drawn over them is drawn again above them,
    // clipped to their frames so ink elsewhere isn't doubled up.
    const frameOf = (e: EmbedItem) => (transforming && this.selection.has(e.id) ? applyRect(embedBounds(e), preview) : embedBounds(e));
    this.embeds.sync(this.drawing.embeds, vp, {
      frame: (e) => {
        const f = frameOf(e);
        return { x: f.x, y: f.y, scale: f.w / e.size.w };
      },
      selected: this.selection,
      interactive: this.tools.tool === "select" && !this.spaceDown && this.gesture?.kind !== "pan",
    });
    const octx = this.octx;
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    octx.setTransform(...toCanvas);
    const frames = this.drawing.embeds.map(frameOf).filter(overlaps);
    if (frames.length > 0 && ink.length > 0) {
      octx.save();
      octx.clip(framesPath(frames));
      this.drawInkPass(octx, ink, px);
      octx.restore();
    }

    this.drawWires(octx, this.drawnWires(frameOf), px);
    this.drawSelectionChrome(octx, preview, px);
    this.drawPending(octx, px);
    if (this.editor.isOpen) {
      const item = this.drawing.math.find((m) => m.id === this.editor.id);
      if (item) this.editor.position(vp.rectToView(mathBounds(item)));
      else this.editor.close();
    }
    if (this.askPrompt.isOpen) {
      const c = this.connecting;
      const a = c && this.drawing.embeds.find((e) => e.id === c.from), b = c && this.drawing.embeds.find((e) => e.id === c.to);
      const bounds = this.selectionBounds;
      if (c && a && b) this.askPrompt.position(this.connectAnchor(a, b));
      else if (!c && bounds) this.askPrompt.position(vp.rectToView(bounds));
      else this.closeAsk();
    }
    this.updateSelectionBar();
    this.updateCursor();
  }

  /** The visible ink (and the stroke being drawn), with the move/resize preview applied. */
  private inkItems(preview: Affine, overlaps: (r: Rect | null) => boolean): (Item & { selected: boolean })[] {
    const transforming = preview !== IDENTITY;
    const items: (Item & { selected: boolean })[] = [];
    for (const stroke of this.visibleStrokes) {
      if (this.erased.has(stroke.id)) continue;
      const selected = this.selection.has(stroke.id);
      let item: Item = { stroke, path: pathFor(stroke) };
      let bounds = strokeBounds(stroke);
      if (selected && transforming) {
        const path = new Path2D();
        path.addPath(item.path, new DOMMatrix([preview.s, 0, 0, preview.s, preview.tx, preview.ty]));
        item = { stroke: { ...stroke, width: stroke.width * preview.s }, path };
        bounds = bounds && applyRect(bounds, preview);
      }
      if (overlaps(bounds)) items.push({ ...item, selected });
    }
    const g = this.gesture;
    if (g?.kind === "stroke") items.push({ stroke: g.stroke, path: smoothPath(g.stroke.points, new Path2D()), selected: false });
    return items;
  }

  /** The ink layer: selection halos, then the ink in one batch so same-color highlights stay flat. */
  private drawInkPass(ctx: CanvasRenderingContext2D, items: readonly (Item & { selected: boolean })[], px: number): void {
    for (const item of items) {
      if (!item.selected) continue;
      ctx.save();
      ctx.strokeStyle = css(ACCENT, 0.28);
      ctx.lineWidth = item.stroke.width + 7 * px;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(item.path);
      ctx.restore();
    }
    drawInk(ctx, items, this.theme);
  }

  private drawSelectionChrome(ctx: CanvasRenderingContext2D, preview: Affine, px: number): void {
    const g = this.gesture;
    if (g?.kind === "lasso" && g.points.length > 1) {
      ctx.save();
      ctx.beginPath();
      g.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = css(ACCENT, 0.06);
      ctx.fill();
      ctx.strokeStyle = css(ACCENT);
      ctx.lineWidth = 1.25 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.stroke();
      ctx.restore();
    }
    const bounds = this.selectionBounds;
    if (!bounds) return;
    const rect = outset(applyRect(bounds, preview), 6 * px);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6 * px);
    ctx.strokeStyle = css(ACCENT, 0.8);
    ctx.lineWidth = px;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.stroke();
    // Math items show their own box so a single item reads as "an object"; cards get an outline.
    ctx.fillStyle = css(ACCENT, 0.07);
    for (const m of this.drawing.math) {
      if (!this.selection.has(m.id)) continue;
      const r = applyRect(mathBounds(m), preview);
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = css(ACCENT, 0.9);
    ctx.lineWidth = 2 * px;
    for (const e of this.selectedEmbeds) {
      const r = applyRect(embedBounds(e), preview);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 10 * (r.w / e.size.w));
      ctx.stroke();
    }
    ctx.restore();
    if (this.tools.tool === "select") {
      const r = RESIZE_HANDLE_RADIUS * px;
      ctx.save();
      ctx.beginPath();
      ctx.arc(rect.x + rect.w, rect.y + rect.h, r, 0, Math.PI * 2);
      ctx.fillStyle = css(this.theme.paper);
      ctx.fill();
      ctx.strokeStyle = css(ACCENT);
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Selections waiting on Claude get a marching outline, and what was asked underneath. */
  private drawPending(ctx: CanvasRenderingContext2D, px: number): void {
    const phase = -performance.now() * 0.018;
    for (const { ids, label, wire } of this.pending.values()) {
      if (wire) {
        // The wire has the ants; say what was asked by its middle.
        const a = this.drawing.embeds.find((e) => e.id === wire.from), b = this.drawing.embeds.find((e) => e.id === wire.to);
        if (!a || !b || !label) continue;
        const mid = pointOnWire(wireCurve(embedBounds(a), embedBounds(b)), 0.5);
        const text = label.length > 80 ? `${label.slice(0, 79)}…` : label;
        ctx.save();
        ctx.font = `500 ${12 * px}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = css(ACCENT);
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(`✦ ${text}`, mid.x, mid.y + 14 * px);
        ctx.restore();
        continue;
      }
      const bounds = boundsOfIDs(this.drawing, ids);
      if (!bounds) continue;
      const r = outset(bounds, 8 * px);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 8 * px);
      ctx.fillStyle = css(ACCENT, 0.05 + 0.04 * Math.sin(phase / 4));
      ctx.fill();
      ctx.strokeStyle = css(ACCENT);
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.lineDashOffset = phase * px;
      ctx.stroke();
      if (label) {
        const text = label.length > 80 ? `${label.slice(0, 79)}…` : label;
        ctx.font = `500 ${12 * px}px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = css(ACCENT);
        ctx.textBaseline = "top";
        ctx.fillText(`✦ ${text}`, r.x, r.y + r.h + 6 * px);
      }
      ctx.restore();
    }
  }

  private updateSelectionBar(): void {
    const link = this.getSelectedLink();
    if (link) return this.updateLinkBar(link);
    const math = this.selectedMath;
    const embeds = this.selectedEmbeds;
    const strokes = this.selectedStrokeIDs;
    this.selectionBar.update({
      canAsk: !!this.options.ask,
      canConvert: strokes.size > 0,
      canEdit: math.length === 1 && this.selection.size === 1,
      canRevert: [...math, ...embeds].some((m) => m.ink.length > 0),
      canCopyLatex: math.length > 0,
    });
    const bar = this.selectionBar.el;
    const bounds = this.selectionBounds;
    const busy =
      (!!this.gesture && this.gesture.kind !== "pan" && this.gesture.kind !== "pinch") || this.editor.isOpen || this.askPrompt.isOpen;
    if (!bounds || busy) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const r = this.viewport.rectToView(bounds);
    let x = r.x + r.w / 2 - bw / 2;
    let y = r.y - bh - 14;
    if (y < 8) y = r.y + r.h + 14;
    x = Math.max(8, Math.min(this.size.w - bw - 8, x));
    y = Math.max(8, Math.min(this.size.h - bh - 8, y));
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
  }

  /** A selected link gets Ask (change the connection) and Delete (disconnect), by its middle. */
  private updateLinkBar(link: LinkItem): void {
    this.selectionBar.update({ canAsk: !!this.options.connect, canConvert: false, canEdit: false, canRevert: false, canCopyLatex: false });
    const bar = this.selectionBar.el;
    const a = this.drawing.embeds.find((e) => e.id === link.from), b = this.drawing.embeds.find((e) => e.id === link.to);
    const busy = (!!this.gesture && this.gesture.kind !== "pan" && this.gesture.kind !== "pinch") || this.askPrompt.isOpen;
    if (!a || !b || busy) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const mid = this.viewport.toView(pointOnWire(wireCurve(embedBounds(a), embedBounds(b)), 0.5));
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    bar.style.left = `${Math.max(8, Math.min(this.size.w - bw - 8, mid.x - bw / 2))}px`;
    bar.style.top = `${Math.max(8, Math.min(this.size.h - bh - 8, mid.y - bh - 22))}px`;
  }

  private updateCursor(): void {
    const cursor = this.cursor();
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  private cursor(): string {
    const g = this.gesture;
    if (g?.kind === "pan") return "grabbing";
    if (this.spaceDown) return "grab";
    if (g?.kind === "move") return "grabbing";
    if (g?.kind === "scale") return "nwse-resize";
    switch (this.tools.tool) {
      case "eraser":
        return circleCursor(ERASER_RADIUS * 2, null);
      case "pen":
      case "marker": {
        const color = this.theme.palette[this.tools.swatch];
        return circleCursor(
          Math.max(this.tools.screenWidth, 4),
          this.tools.tool === "marker" ? css(color, this.theme.markerAlpha) : css(color),
        );
      }
      case "connect":
        if (g?.kind === "connect") return g.to ? "alias" : "crosshair";
        return this.hover && embedAt(this.viewport.toCanvas(this.hover), this.drawing.embeds, 4 / this.viewport.scale) ? "alias" : "crosshair";
      case "select": {
        const handle = this.resizeHandleCenter;
        if (handle && this.hover && distance(this.hover, handle) <= RESIZE_HANDLE_RADIUS + 6) return "nwse-resize";
        if (this.hoveredLink) return "pointer";
        if (this.hover && embedAt(this.viewport.toCanvas(this.hover), this.drawing.embeds, 4 / this.viewport.scale)) return "grab";
        return "crosshair";
      }
    }
  }
}

const cursorCache = new Map<string, string>();

/** A round cursor with a light and a dark outline, so it shows on any ink. */
function circleCursor(diameter: number, fill: string | null): string {
  const key = `${diameter}|${fill}`;
  let cursor = cursorCache.get(key);
  if (!cursor) {
    const size = Math.ceil(diameter + 4);
    const c = size / 2, r = diameter / 2;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      (fill ? `<circle cx="${c}" cy="${c}" r="${r}" fill="${fill}"/>` : "") +
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2"/>` +
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(0,0,0,0.6)" stroke-width="1"/></svg>`;
    cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${Math.round(c)} ${Math.round(c)}, crosshair`;
    cursorCache.set(key, cursor);
  }
  return cursor;
}

/** Applies side updates to the embeds still on the board. */
function withUpdates(d: Drawing, updates: readonly AskSideUpdate[]): Drawing {
  return updates.reduce((acc, u) => (acc.embeds.some((e) => e.id === u.id) ? updatingEmbed(acc, u.id, { data: u.data }) : acc), d);
}

/** Mounts a sketcher into `el`. */
export function createSketcher(el: HTMLElement, options: SketcherOptions = {}): Sketcher {
  return new Sketcher(el, options);
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
