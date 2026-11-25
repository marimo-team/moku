// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/ui/dom.ts. Edit it there and rerun scripts/sketcher.ts.
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Record<string, string> = {}, children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

/** A toolbar button with an inline SVG icon. Doesn't take focus, so keys keep going to the canvas. */
export function iconButton(icon: string, title: string, onClick: () => void, extraClass = ""): HTMLButtonElement {
  const b = h("button", { class: `sk-button ${extraClass}`.trim(), title, "aria-label": title, type: "button" });
  b.innerHTML = icon;
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Shortcut label, e.g. `⇧⌘E` on a Mac and `Ctrl+Shift+E` elsewhere. */
export function shortcut(key: string, { shift = false, mod = true } = {}): string {
  if (isMac) return `${shift ? "⇧" : ""}${mod ? "⌘" : ""}${key}`;
  return [mod ? "Ctrl" : "", shift ? "Shift" : "", key].filter(Boolean).join("+");
}

/** Places a popover below `anchor` (or above it if there's no room), inside `host`. */
export function placePopover(el: HTMLElement, anchor: { x: number; y: number; w: number; h: number }, host: HTMLElement): void {
  const w = el.offsetWidth, hgt = el.offsetHeight;
  const W = host.clientWidth, H = host.clientHeight;
  let y = anchor.y + anchor.h + 12;
  if (y + hgt > H - 8 && anchor.y - hgt - 12 >= 8) y = anchor.y - hgt - 12;
  const x = anchor.x + anchor.w / 2 - w / 2;
  el.style.left = `${Math.max(8, Math.min(W - w - 8, x))}px`;
  el.style.top = `${Math.max(8, Math.min(H - hgt - 8, y))}px`;
}

/** Keeps keys, clicks, scrolling and clipboard events in a popover away from the board and the page. */
export function isolate(el: HTMLElement): void {
  for (const type of ["keyup", "pointerdown", "wheel", "copy", "cut", "paste"]) el.addEventListener(type, (e) => e.stopPropagation());
}
