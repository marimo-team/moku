import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  layoutGraph,
  layoutView,
  ROW_HEIGHT,
  validateGroup,
  type ViewGroup,
} from "../src/graph/layout.ts";
import type { Edge } from "../src/graph/dependencies.ts";

const edges = (...pairs: Array<[string, string]>): Edge[] =>
  pairs.map(([from, to]) => ({ from, to, names: [from] }));

test("branches reserve their lanes through the final downstream connection", () => {
  const graph = edges(
    ["setup", "orders"],
    ["setup", "fx"],
    ["setup", "publish"],
    ["orders", "models"],
    ["fx", "models"],
    ["models", "publish"],
  );
  const placement = layoutGraph(["setup", "orders", "fx", "models", "publish"], graph);
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
  const view = layoutView(placement.order, graph, [], new Set());
  NodeAssert.equal(view.edges.length, graph.length);
  NodeAssert.ok(view.edges.some((edge) => edge.path.includes(" Q ") && edge.path.includes(" H ")));
  NodeAssert.ok(view.edges.every((edge) => edge.arrow.endsWith("Z")));
});

test("expanded groups keep their internal graph and outer connections", () => {
  const graph = edges(["source", "a"], ["a", "b"], ["a", "c"], ["b", "sink"], ["c", "sink"]);
  const group: ViewGroup = {
    id: "view-group:models",
    label: "Build models",
    members: ["a", "b", "c"],
  };
  const open = layoutView(["source", "a", "b", "c", "sink"], graph, [group], new Set());
  NodeAssert.deepEqual(
    open.rows.map((row) => row.id),
    ["source", group.id, "a", "b", "c", "sink"],
  );
  NodeAssert.equal(open.edges.filter((edge) => edge.from === "a").length, 2);
  NodeAssert.ok(open.rows.find((row) => row.id === "a")!.labelX > open.rows[1].labelX);
  const outer = open.edges.find((edge) => edge.from === group.id)!;
  NodeAssert.equal(outer.to, "sink");
  NodeAssert.ok(
    outer.path.includes(String(5 * ROW_HEIGHT + ROW_HEIGHT / 2)) ||
      outer.path.includes(String(5 * ROW_HEIGHT + ROW_HEIGHT / 2 - 12)),
  );
  const closed = layoutView(["source", "a", "b", "c", "sink"], graph, [group], new Set([group.id]));
  NodeAssert.deepEqual(
    closed.rows.map((row) => row.id),
    ["source", group.id, "sink"],
  );
  NodeAssert.equal(closed.edges.length, 2);
});

test("nested groups are a hierarchy, and collapsing does not lose cells", () => {
  const graph = edges(["a", "b"], ["b", "c"], ["c", "d"]);
  const inner = {
    id: "view-group:inner",
    label: "Inner",
    members: ["a", "b"],
  };
  const outer = {
    id: "view-group:outer",
    label: "Outer",
    members: ["a", "b", "c"],
  };
  const view = layoutView(["a", "b", "c", "d"], graph, [inner, outer], new Set());
  NodeAssert.deepEqual(
    view.rows.map((row) => row.depth),
    [0, 1, 2, 2, 1, 0],
  );
  NodeAssert.deepEqual(
    view.rows.filter((row) => row.label === undefined).map((row) => row.id),
    ["a", "b", "c", "d"],
  );
  NodeAssert.match(validateGroup([inner], ["b", "c"], graph)!, /nested or separate/);
  NodeAssert.match(validateGroup([], ["a", "c"], graph)!, /intermediate/);
});

test("cycles are retained as feedback paths and deleted cells do not duplicate groups", () => {
  const graph = edges(["a", "b"], ["b", "a"]);
  const view = layoutView(["a", "b"], graph, [], new Set());
  NodeAssert.equal(view.rows.length, 2);
  NodeAssert.equal(view.edges.length, 2);
  NodeAssert.equal(view.edges.filter((edge) => edge.feedback).length, 1);
  const groups = [
    { id: "view-group:inner", label: "Inner", members: ["a", "b"] },
    {
      id: "view-group:outer",
      label: "Outer",
      members: ["a", "b", "deleted"],
    },
  ];
  const edited = layoutView(["a", "b"], [], groups, new Set());
  NodeAssert.deepEqual(
    edited.rows.filter((row) => row.label === undefined).map((row) => row.id),
    ["a", "b"],
  );
});
