import * as NodeAssert from "node:assert/strict";
import * as Vitest from "vite-plus/test";
import {
  layoutGraph,
  layoutView,
} from "../../src/plugins/graph-explainer/diagram/layout.ts";
import type { Edge } from "../../src/plugins/graph-explainer/diagram/dependencies.ts";

const edges = (...pairs: Array<[string, string]>): Edge[] =>
  pairs.map(([from, to]) => ({ from, to, names: [from] }));

Vitest.test(
  "branches reserve their lanes through the final downstream connection",
  () => {
    const graph = edges(
      ["setup", "orders"],
      ["setup", "fx"],
      ["setup", "publish"],
      ["orders", "models"],
      ["fx", "models"],
      ["models", "publish"],
    );
    const placement = layoutGraph(
      ["setup", "orders", "fx", "models", "publish"],
      graph,
    );
    NodeAssert.notEqual(placement.lanes.get("orders"), placement.lanes.get("fx"));
    const positions = new Map(placement.order.map((id, index) => [id, index]));
    for (const edge of graph) {
      const intermediate = placement.order.slice(
        positions.get(edge.from)! + 1,
        positions.get(edge.to),
      );
      for (const id of intermediate)
        NodeAssert.notEqual(
          placement.lanes.get(edge.from),
          placement.lanes.get(id),
          `${edge.from} → ${edge.to} must not run through ${id}`,
        );
    }
    const view = layoutView(placement.order, graph);
    NodeAssert.equal(view.edges.length, graph.length);
    NodeAssert.ok(
      view.edges.some((edge) => edge.path.includes(" Q ") && edge.path.includes(" H ")),
    );
    NodeAssert.ok(view.edges.every((edge) => edge.arrow.endsWith("Z")));
  },
);

Vitest.test("cycles are retained as feedback paths", () => {
  const graph = edges(["a", "b"], ["b", "a"]);
  const view = layoutView(["a", "b"], graph);
  NodeAssert.equal(view.rows.length, 2);
  NodeAssert.equal(view.edges.length, 2);
  NodeAssert.equal(view.edges.filter((edge) => edge.feedback).length, 1);
});
