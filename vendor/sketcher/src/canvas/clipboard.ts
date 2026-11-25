// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/canvas/clipboard.ts. Edit it there and rerun scripts/sketcher.ts.
import { decodeFragment, encodeFragment } from "../core/codec";
import type { Fragment } from "../core/model";

export const FRAGMENT_MIME = "application/x-sketcher-fragment";
const TEXT_TAG = "sketcher-fragment";

/** The last copied fragment, for when the system clipboard isn't available. Shared by all sketchers on the page. */
let memory: Fragment | null = null;

/** Writes a fragment to a clipboard event (if any) and the in-page clipboard. */
export function writeFragment(fragment: Fragment, data: DataTransfer | null, plainText?: string): void {
  memory = fragment;
  const json = JSON.stringify(encodeFragment(fragment));
  const text = plainText ?? JSON.stringify({ type: TEXT_TAG, fragment: encodeFragment(fragment) });
  if (data) {
    data.setData(FRAGMENT_MIME, json);
    data.setData("text/plain", text);
  } else {
    navigator.clipboard?.writeText(text).catch(() => {});
  }
}

/** Reads a fragment from a paste event, falling back to the in-page clipboard. */
export function readFragment(data: DataTransfer | null): Fragment | null {
  if (data) {
    try {
      const raw = data.getData(FRAGMENT_MIME);
      if (raw) return decodeFragment(JSON.parse(raw));
    } catch {
      /* fall through */
    }
    try {
      const parsed = JSON.parse(data.getData("text/plain"));
      if (parsed?.type === TEXT_TAG) return decodeFragment(parsed.fragment);
    } catch {
      /* not ours */
    }
    // Plain LaTeX we copied ourselves (math only) still pastes as the math items.
    if (memory && memory.strokes.length === 0 && memory.embeds.length === 0 && data.getData("text/plain") === memory.math.map((m) => m.latex).join("\n")) {
      return memory;
    }
    // Something else is on the system clipboard: only use our copy if nothing at all is there.
    if (data.types.length > 0) return null;
  }
  return memory;
}

export function copyImage(png: Promise<Blob | null>): Promise<void> {
  const blob = png.then((b) => {
    if (!b) throw new Error("Nothing to copy");
    return b;
  });
  return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}
