/** Tables of a query's nodes, relationships, or raw records. @module */
import { html } from "./dom.ts";
import * as Result from "./result.ts";

/** Which table to draw. */
export type Table = "nodes" | "relationships" | "records";

/**
 * Draws one table of `result`.
 *
 * Node and relationship rows report clicks to `onSelect`, toggling off the row
 * that is already `selected`.
 */
export function draw(
  table: Table,
  result: Result.Result,
  selected: string | undefined,
  onSelect: (id: string | undefined) => void,
): HTMLElement {
  const nodes = new Map(result.nodes.map((node) => [node.id, node]));
  const labels = Result.labelOrder(result.nodes);
  const row = (id: string, ...cells: HTMLElement[]) => {
    const element = html("tr", { "aria-selected": String(id === selected) }, ...cells);
    element.addEventListener("click", () => onSelect(id === selected ? undefined : id));
    return element;
  };
  const nodeChip = (id: string) => {
    const node = nodes.get(id);
    if (!node) return html("code", {}, id);
    const swatch = html("i");
    swatch.style.background = Result.labelColor(labels.indexOf(node.labels[0] ?? ""));
    return html(
      "span",
      { class: "cypher-chip", title: id },
      swatch,
      Result.caption(node) || node.labels.join(":"),
    );
  };

  if (table === "nodes") {
    const keys = Result.propertyKeys(result.nodes);
    return grid(
      ["Labels", ...keys],
      "No nodes.",
      result.nodes.map((node) =>
        row(
          node.id,
          html("td", {}, nodeChip(node.id)),
          ...keys.map((key) => html("td", {}, value(node.properties[key]))),
        ),
      ),
    );
  }

  if (table === "relationships") {
    const keys = Result.propertyKeys(result.relationships);
    return grid(
      ["From", "Type", "To", ...keys],
      "No relationships.",
      result.relationships.map((relationship) =>
        row(
          relationship.id,
          html("td", {}, nodeChip(relationship.start)),
          html("td", {}, html("code", {}, `:${relationship.type}`)),
          html("td", {}, nodeChip(relationship.end)),
          ...keys.map((key) => html("td", {}, value(relationship.properties[key]))),
        ),
      ),
    );
  }

  const relationships = new Map(result.relationships.map((entry) => [entry.id, entry]));
  return grid(
    result.keys,
    "The query returned no records.",
    result.records.map((record) =>
      html(
        "tr",
        {},
        ...record.map((entry) => {
          const ref = Result.reference(entry);
          if (ref && "$node" in ref) return html("td", {}, nodeChip(ref.$node));
          if (ref && "$relationship" in ref) {
            const relationship = relationships.get(ref.$relationship);
            return html(
              "td",
              {},
              html("code", {}, `:${relationship?.type ?? ref.$relationship}`),
            );
          }
          if (ref && "$path" in ref) {
            return html(
              "td",
              { class: "cypher-path" },
              ...ref.$path.flatMap((id, step) => [
                step > 0 && html("span", { "aria-hidden": "true" }, "→"),
                nodeChip(id),
              ]),
            );
          }
          return html("td", {}, value(entry));
        }),
      ),
    ),
  );
}

/** A scrolling table, or `empty` as a notice when there are no rows. */
function grid(
  columns: readonly string[],
  empty: string,
  rows: readonly HTMLElement[],
): HTMLElement {
  if (rows.length === 0 && columns.length === 0)
    return html("p", { class: "cypher-notice" }, empty);
  return html(
    "div",
    { class: "cypher-table" },
    html(
      "table",
      {},
      html(
        "thead",
        {},
        html(
          "tr",
          {},
          ...columns.map((column) => html("th", { scope: "col" }, column)),
        ),
      ),
      html("tbody", {}, ...rows),
    ),
    rows.length === 0 && html("p", { class: "cypher-notice" }, empty),
  );
}

function value(entry: unknown): Node | string {
  if (entry === undefined) return html("span", { class: "cypher-missing" }, "—");
  return Result.formatValue(entry);
}
