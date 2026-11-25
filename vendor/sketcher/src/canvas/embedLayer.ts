// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/canvas/embedLayer.ts. Edit it there and rerun scripts/sketcher.ts.
// Embedded items as DOM cards above the canvas. One plane carries the viewport transform, so cards
// pan and zoom with the board for the cost of one style change per frame; each card sits at its
// canvas position inside it. The host fills each card's content element (see `MountEmbed`).
import type { Rect } from "../core/geometry";
import { EMBED_HEADER, type EmbedItem } from "../core/model";
import type { Viewport } from "../core/viewport";
import { h } from "../ui/dom";

/**
 * Fills an embed card. Called once per item, and again if its `ref` changes; the returned cleanup
 * runs when the item leaves the board (deleted, reverted, undone) or the board is destroyed.
 */
export type MountEmbed = (item: EmbedItem, el: HTMLElement) => (() => void) | void;

/** Bounds on the size cards fit themselves to, in canvas units at scale 1. */
export const EMBED_MIN = { h: 72 };
export const EMBED_MAX = { w: 960, h: 1600 };

interface Card {
  el: HTMLDivElement;
  title: HTMLSpanElement;
  content: HTMLDivElement;
  body: HTMLDivElement;
  item: EmbedItem;
  cleanup: (() => void) | void;
  observer: ResizeObserver;
}

export interface EmbedLayerState {
  /** Frame on the canvas for each item, e.g. following the pointer mid-move. */
  frame(item: EmbedItem): { x: number; y: number; scale: number };
  selected: ReadonlySet<string>;
  /** Whether content takes the pointer (select tool, not panning). */
  interactive: boolean;
}

export interface EmbedLayerEvents {
  /** The card's content would like this size (canvas units at scale 1). */
  fit(id: string, size: { w: number; h: number }): void;
  /** A wheel event over a card that the card doesn't scroll. */
  wheel(e: WheelEvent): void;
  /** The pointer went over a card (its ID), or left it (null). */
  hover(id: string | null): void;
}

export class EmbedLayer {
  readonly el: HTMLDivElement;
  private readonly plane: HTMLDivElement;
  private readonly cards = new Map<string, Card>();
  /** The card the pointer last went down in; it gets the wheel, others pan the board. */
  private active: string | null = null;

  constructor(private readonly mount: MountEmbed | undefined, private readonly events: EmbedLayerEvents) {
    this.plane = h("div", { class: "sk-embed-plane" });
    this.el = h("div", { class: "sk-embeds" }, [this.plane]);
  }

  /** Clears the active card, e.g. when the pointer goes down on the paper. */
  deactivate(): void {
    if (!this.active) return;
    this.cards.get(this.active)?.el.classList.remove("sk-active");
    this.active = null;
  }

  /** Whether the event came from inside a card (content or header). */
  owns(e: Event): boolean {
    return e.composedPath().some((t) => t instanceof Node && t !== this.el && this.el.contains(t));
  }

  /** Brings the cards in line with the items: adds, removes, moves and remounts as needed. */
  sync(items: readonly EmbedItem[], vp: Viewport, state: EmbedLayerState): void {
    this.plane.style.transform = `translate(${vp.offset.x}px, ${vp.offset.y}px) scale(${vp.scale})`;
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      seen.add(item.id);
      let card = this.cards.get(item.id);
      if (card && card.item.ref !== item.ref) {
        this.remove(card);
        card = undefined;
      }
      if (!card) {
        card = this.create(item);
        this.cards.set(item.id, card);
        this.plane.append(card.el);
      }
      const sizeChanged = card.item.size.w !== item.size.w || card.item.size.h !== item.size.h;
      if (card.item.title !== item.title || !card.title.textContent) card.title.textContent = item.title || item.ref;
      card.item = item;
      const f = state.frame(item);
      const s = card.el.style;
      s.left = `${f.x}px`;
      s.top = `${f.y}px`;
      s.width = `${item.size.w}px`;
      s.height = `${item.size.h}px`;
      s.transform = f.scale === 1 ? "" : `scale(${f.scale})`;
      card.el.classList.toggle("sk-selected", state.selected.has(item.id));
      card.content.inert = !state.interactive;
      // Later items are on top. (Reordering the DOM instead would reload iframes in the content.)
      s.zIndex = String(index);
      if (sizeChanged) this.checkFit(card);
    }
    for (const [id, card] of this.cards) if (!seen.has(id)) this.remove(card);
  }

  destroy(): void {
    for (const card of this.cards.values()) this.remove(card);
  }

  private create(item: EmbedItem): Card {
    const title = h("span", { class: "sk-embed-title" });
    const body = h("div", { class: "sk-embed-body" });
    const content = h("div", { class: "sk-embed-content" }, [body]);
    const el = h("div", { class: "sk-embed", "data-ref": item.ref }, [
      h("div", { class: "sk-embed-header", style: `height:${EMBED_HEADER}px` }, [title]),
      content,
    ]);
    // What happens in a card stays there: typing in a widget mustn't switch tools or delete the
    // selection, and pasting into it mustn't paste ink.
    for (const type of ["keydown", "keyup", "copy", "cut", "paste"]) el.addEventListener(type, (e) => e.stopPropagation());
    el.addEventListener("pointerenter", () => this.events.hover(card.item.id));
    el.addEventListener("pointerleave", () => this.events.hover(null));
    content.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (this.active !== item.id) {
        this.deactivate();
        this.active = item.id;
        el.classList.add("sk-active");
      }
    });
    el.addEventListener(
      "wheel",
      (e) => {
        // Pinch and ⌘-scroll always zoom the board; plain scrolling belongs to the active card.
        if (e.ctrlKey || e.metaKey || this.active !== this.idOf(el)) {
          e.stopPropagation();
          this.events.wheel(e);
        }
      },
      { passive: false },
    );
    if (!this.mount) body.append(h("div", { class: "sk-embed-placeholder" }, [item.ref]));
    const card: Card = {
      el, title, content, body, item, cleanup: undefined,
      observer: new ResizeObserver(() => this.checkFit(card)),
    };
    card.cleanup = this.mount?.(item, body);
    card.observer.observe(body);
    return card;
  }

  private idOf(el: HTMLElement): string | null {
    for (const [id, card] of this.cards) if (card.el === el) return id;
    return null;
  }

  /**
   * Fits the card's height to its content, and widens it (up to `EMBED_MAX.w`) for content wider
   * than the card, like a table, whose overflow would otherwise hide behind an invisible scrollbar.
   * It never narrows: content that sizes itself to its container (charts often do) doesn't
   * overflow, so it doesn't keep widening the card either.
   */
  private checkFit(card: Card): void {
    if (!card.el.isConnected || this.cards.get(card.item.id) !== card) return;
    // Layout sizes, so the card's zoom doesn't matter.
    const natural = card.body.offsetHeight;
    if (natural === 0) return;
    const { size } = card.item;
    const h = Math.min(EMBED_MAX.h, Math.max(EMBED_MIN.h, EMBED_HEADER + natural + 2));
    const overflow = widestOverflow(card.body);
    const w = overflow > 1 ? Math.max(size.w, Math.min(EMBED_MAX.w, Math.ceil(size.w + overflow))) : size.w;
    if (Math.abs(h - size.h) > 1 || w !== size.w) this.events.fit(card.item.id, { w, h });
  }

  private remove(card: Card): void {
    card.observer.disconnect();
    try {
      card.cleanup?.();
    } catch (error) {
      console.error("Sketcher: an embed's cleanup failed", error);
    }
    card.el.remove();
    if (this.active === card.item.id) this.active = null;
    if (this.cards.get(card.item.id) === card) this.cards.delete(card.item.id);
  }
}

/**
 * How much wider than its box the widest overflowing element under `root` is, looking into shadow
 * roots (marimo outputs live in them). Tables often scroll in a box of their own, so the card's
 * body alone doesn't show it. Graphics are skipped: they don't scroll.
 */
function widestOverflow(root: Element): number {
  let widest = root.scrollWidth - root.clientWidth;
  const visit = (el: Element) => {
    if (el instanceof SVGElement || el instanceof HTMLCanvasElement) return;
    if (el.clientWidth > 0) widest = Math.max(widest, el.scrollWidth - el.clientWidth);
    if (el.shadowRoot) for (const child of el.shadowRoot.children) visit(child);
    for (const child of el.children) visit(child);
  };
  for (const child of root.children) visit(child);
  return widest;
}

/** The union of the items' frames, for clipping ink drawn on top of them. */
export function framesPath(frames: readonly Rect[]): Path2D {
  const path = new Path2D();
  for (const r of frames) path.rect(r.x, r.y, r.w, r.h);
  return path;
}
