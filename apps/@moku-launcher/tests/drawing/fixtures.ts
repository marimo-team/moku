import type { EmbedItem, LinkItem } from "sketcher";

let next = 0;

/** A card for the cell `ref`, made from `code`. */
export function card(
  ref: string,
  code: string | null = `${ref} = 1`,
  askId: string = `ask-${ref}`,
  id = `E${++next}`,
): EmbedItem {
  return {
    id,
    ref,
    title: ref,
    origin: { x: 0, y: 0 },
    size: { w: 300, h: 200 },
    scale: 1,
    ink: [],
    data: code === null ? null : { code, askId },
  };
}

/** Cells by name, as the controller sees them. */
export const cells = (entries: Record<string, string | null>) =>
  new Map(
    Object.entries(entries).map(([name, code]) => [name, { id: `id-${name}`, code }]),
  );

/** A link between two cards that brought `helpers` along. */
export function link(
  from: EmbedItem,
  to: EmbedItem,
  helpers: { name: string; code: string }[] = [],
  askId = "link-ask",
  id = `L${++next}`,
): LinkItem {
  return { id, from: from.id, to: to.id, label: "", data: { askId, helpers } };
}
