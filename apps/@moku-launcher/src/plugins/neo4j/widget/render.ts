/**
 * The anywidget front end of `CypherGraph`, drawing a query result as a graph and tables.
 *
 * Bundled into the notebook's generated widget cell, so it runs wherever the
 * notebook does, including stock marimo and HTML exports.
 *
 * @module
 */
import css from "./style.css?inline";
import * as Graph from "./graph.ts";
import { html } from "./dom.ts";
import type * as Result from "./result.ts";
import * as Tables from "./tables.ts";

/** The part of anywidget's model this widget uses. */
interface Model {
  get(name: "data"): Result.Result;
  set(name: "_expand", value: { readonly id: string; readonly request: number }): void;
  save_changes(): void;
  on(event: "change:data", callback: () => void): void;
  off(event: "change:data", callback: () => void): void;
}

type Tab = "graph" | Tables.Table;

/** What a redraw keeps from the drawing it replaces. */
interface State {
  active?: Tab;
  selected?: string;
  layout?: Graph.Layout;
  /** The node being expanded, while its neighbors are on their way. */
  expanding?: string;
}

function mount(
  el: HTMLElement,
  result: Result.Result,
  state: State,
  expand: ((id: string) => void) | undefined,
): () => Graph.Layout | undefined {
  const root = html("section", { class: "cypher-result" });
  // Styles travel inside the widget rather than through anywidget's `_css`,
  // because marimo replaces a shadow root's adopted stylesheets when it
  // recopies page styles, such as on a theme change.
  el.replaceChildren(html("style", {}, css), root);
  if (result.keys.length === 0 && result.nodes.length === 0) {
    root.append(html("p", { class: "cypher-notice" }, "The query returned nothing."));
    return () => undefined;
  }

  const hasGraph = result.nodes.length > 0;
  const tabs: readonly { id: Tab; label: string }[] = hasGraph
    ? [
        { id: "graph", label: "Graph" },
        { id: "nodes", label: `Nodes ${result.nodes.length}` },
        { id: "relationships", label: `Relationships ${result.relationships.length}` },
        { id: "records", label: `Records ${result.records.length}` },
      ]
    : [{ id: "records", label: `Records ${result.records.length}` }];
  if (!tabs.some((tab) => tab.id === state.active)) state.active = tabs[0]!.id;
  let graph: Graph.View | undefined;

  const strip = html("div", { class: "cypher-tabs", role: "tablist" });
  const buttons = tabs.map((tab) => {
    const button = html("button", { role: "tab", type: "button" }, tab.label);
    button.addEventListener("click", () => {
      state.active = tab.id;
      show();
    });
    strip.append(button);
    return button;
  });
  const status = html("span", { class: "cypher-error", role: "status" });
  strip.append(status);
  if (result.error) status.textContent = result.error;
  else if (result.truncated)
    status.textContent = `Showing the first ${result.limit.toLocaleString()} of each`;
  const panel = html("div", { role: "tabpanel" });
  root.append(strip, panel);

  const select = (id: string | undefined) => {
    state.selected = id;
    if (state.active === "graph") graph?.select(id);
    else show();
  };
  const onExpand =
    expand &&
    ((id: string) => {
      state.expanding = id;
      status.textContent = "Expanding…";
      expand(id);
    });
  const show = () => {
    tabs.forEach((tab, index) =>
      buttons[index]!.setAttribute("aria-selected", String(tab.id === state.active)),
    );
    if (state.active === "graph") {
      if (!graph) {
        graph = Graph.draw(result, {
          onSelect: select,
          onExpand,
          previous: state.layout,
          focus: state.expanding,
        });
        state.expanding = undefined;
      }
      graph.select(state.selected);
      panel.replaceChildren(graph.element);
    } else {
      panel.replaceChildren(Tables.draw(state.active!, result, state.selected, select));
    }
  };
  show();
  return () => {
    const layout = graph?.layout();
    graph?.dispose();
    return layout;
  };
}

export default {
  render({ model, el }: { model: Model; el: HTMLElement }) {
    el.classList.add("moku-cypher-graph");
    const state: State = {};
    let requests = 0;
    const expand = (id: string) => {
      model.set("_expand", { id, request: ++requests });
      model.save_changes();
    };
    const draw = () => {
      const result = model.get("data");
      return mount(el, result, state, result.expandable ? expand : undefined);
    };
    let dispose = draw();
    const update = () => {
      state.layout = dispose() ?? state.layout;
      dispose = draw();
    };
    model.on("change:data", update);
    return () => {
      model.off("change:data", update);
      dispose();
    };
  },
};
