import * as NodeAssert from "node:assert/strict";
import * as Vitest from "vite-plus/test";
import * as Reorder from "../../src/plugins/notebook/cells/reorder.ts";
import * as Selection from "../../src/plugins/notebook/cells/useCellSelection.ts";
import * as Source from "../../src/plugins/notebook/cells/source.ts";

const order = ["a", "b", "c", "d", "e"];
const ids = (state: Selection.State) => order.filter((id) => state.ids.has(id));

Vitest.test(
  "Shift with arrow keys grows and shrinks a range from the first focused cell",
  () => {
    let state = Selection.extend(Selection.empty, order, "b", "c");
    NodeAssert.deepEqual(ids(state), ["b", "c"]);
    state = Selection.extend(state, order, "c", "d");
    NodeAssert.deepEqual(ids(state), ["b", "c", "d"]);
    state = Selection.extend(state, order, "d", "c");
    NodeAssert.deepEqual(ids(state), ["b", "c"]);
    state = Selection.extend(state, order, "b", "a");
    NodeAssert.deepEqual(ids(state), ["a", "b"]);
  },
);

Vitest.test(
  "clicks toggle cells and Shift-clicks add the range from the anchor",
  () => {
    let state = Selection.click(Selection.empty, order, "b", "toggle");
    state = Selection.click(state, order, "d", "range");
    NodeAssert.deepEqual(ids(state), ["b", "c", "d"]);
    state = Selection.click(state, order, "c", "toggle");
    NodeAssert.deepEqual(ids(state), ["b", "d"]);
    NodeAssert.deepEqual(ids(Selection.all(state, order)), order);
  },
);

Vitest.test("moving keeps blocks together and stops at the edges", () => {
  NodeAssert.deepEqual(Reorder.move(order, new Set(["c", "d"]), "up"), [
    "a",
    "c",
    "d",
    "b",
    "e",
  ]);
  NodeAssert.deepEqual(Reorder.move(order, new Set(["b", "c"]), "down"), [
    "a",
    "d",
    "b",
    "c",
    "e",
  ]);
  NodeAssert.equal(Reorder.move(order, new Set(["a", "b"]), "up"), order);
  NodeAssert.deepEqual(Reorder.move(order, new Set(["a", "c"]), "up"), [
    "a",
    "c",
    "b",
    "d",
    "e",
  ]);
});

Vitest.test("focus moves past deleted cells, or back when they reach the end", () => {
  NodeAssert.equal(Reorder.focusAfterDelete(order, new Set(["b", "c"])), "d");
  NodeAssert.equal(Reorder.focusAfterDelete(order, new Set(["d", "e"])), "c");
  NodeAssert.equal(Reorder.focusAfterDelete(order, new Set(order)), undefined);
});

Vitest.test("new Markdown and SQL cells read back in their language", () => {
  NodeAssert.equal(Source.read(Source.create("markdown", "# Hi")).language, "markdown");
  NodeAssert.equal(Source.read(Source.create("sql", "SELECT 1")).language, "sql");
  NodeAssert.ok(Source.importsMarimo("import numpy as np\nimport marimo as mo"));
  NodeAssert.ok(!Source.importsMarimo("import marimo as _mo"));
});
