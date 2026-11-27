import * as NodeAssert from "node:assert/strict";

import * as Vitest from "vite-plus/test";

import type { Edge } from "../../src/plugins/graph-explainer/diagram/dependencies.ts";
import { layoutView } from "../../src/plugins/graph-explainer/diagram/layout.ts";

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
    const view = layoutView(["setup", "orders", "fx", "models", "publish"], graph);
    NodeAssert.equal(view.edges.length, graph.length);
    for (const edge of graph) {
      const start = view.rows.findIndex((row) => row.id === edge.from);
      const end = view.rows.findIndex((row) => row.id === edge.to);
      NodeAssert.ok(start >= 0 && start < end);
      for (const row of view.rows.slice(start + 1, end))
        NodeAssert.notEqual(
          row.x,
          view.rows[start].x,
          `${edge.from} → ${edge.to} must not run through ${row.id}`,
        );
    }
  },
);

Vitest.test("cycles are retained as feedback paths", () => {
  const graph = edges(["a", "b"], ["b", "a"]);
  const view = layoutView(["a", "b"], graph);
  NodeAssert.equal(view.rows.length, 2);
  NodeAssert.equal(view.edges.length, 2);
  NodeAssert.equal(view.edges.filter((edge) => edge.feedback).length, 1);
});
