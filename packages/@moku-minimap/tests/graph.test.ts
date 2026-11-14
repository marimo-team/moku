import { Schema } from "effect";
import * as Protocol from "@moku/core/Protocol";
import { result, type Observation } from "../../@moku-core/tests/state.ts";
import type { NotebookState } from "../../@moku-core/src/notebook/state.ts";
import * as Vitest from "vite-plus/test";
import { Atom, AtomRegistry } from "effect/reactivity";

import * as Model from "../src/model.ts";
import { fixture } from "./fixture.ts";

function observe(initial = fixture()) {
  const registry = AtomRegistry.make();
  const state = Atom.make<Observation>({
    value: initial,
    status: "connected",
    error: null,
    source: { document: null, canEdit: false },
  });
  const model = Model.make(Atom.map(state, result));
  registry.mount(model.graph);
  Vitest.onTestFinished(() => registry.dispose());
  return {
    graph: () => registry.get(model.graph),
    update: (value: NotebookState) =>
      registry.update(state, (state) => ({ ...state, value })),
  };
}

Vitest.test(
  "graph preserves document order and separates direct edges from reachability",
  () => {
    const graph = observe().graph();
    Vitest.expect(graph.items.map((item) => item.id)).toEqual([
      "result",
      "source",
      "middle",
      "isolated",
    ]);
    Vitest.expect(graph.dependencies("middle")).toEqual(new Set(["source"]));
    Vitest.expect(graph.dependencies("result")).toEqual(new Set(["middle"]));
    Vitest.expect(graph.dependents("source")).toEqual(new Set(["middle"]));
    Vitest.expect(graph.trace("result")?.upstream).toEqual(
      new Set(["middle", "source"]),
    );
    Vitest.expect(graph.trace("source")?.downstream).toEqual(
      new Set(["middle", "result"]),
    );
    Vitest.expect(graph.dependencies("isolated").size).toBe(0);
    Vitest.expect(graph.get("source")?.definitions).toEqual(["x", "extra"]);
  },
);

Vitest.test(
  "cycles terminate and exclude the origin; missing references and cells are tolerated",
  () => {
    const state = fixture();
    state.analysis = {
      ...state.analysis,
      cells: {
        ...state.analysis.cells,
        source: { ...state.analysis.cells.source, refs: ["z", "x"] },
      },
    };
    const view = observe(state);
    const graph = view.graph();
    Vitest.expect(graph.dependencies("source")).toEqual(new Set(["result"]));
    Vitest.expect(graph.trace("source")?.upstream).toEqual(
      new Set(["middle", "result"]),
    );
    Vitest.expect(graph.trace("source")?.downstream).toEqual(
      new Set(["middle", "result"]),
    );
    Vitest.expect(graph.trace("missing")).toBeUndefined();
    Vitest.expect(graph.get("missing")).toBeUndefined();
    Vitest.expect(graph.dependencies("missing").size).toBe(0);
    const { middle: _removed, ...cells } = state.cells;
    view.update({ ...state, cells });
    Vitest.expect(view.graph().dependencies("result").size).toBe(0);
    Vitest.expect(view.graph().items.map((item) => item.id)).toEqual([
      "result",
      "source",
      "isolated",
    ]);
  },
);

Vitest.test("stale analysis keeps rows while withdrawing dependency claims", () => {
  const state = fixture();
  const view = observe(state);
  for (const analysis of [state.analysis, null]) {
    view.update({
      ...state,
      document: Schema.decodeUnknownSync(Protocol.Document)({
        ...state.document,
        etag: "v2",
      }),
      analysis,
    });
    const graph = view.graph();
    Vitest.expect(graph.current).toBe(false);
    Vitest.expect(graph.items).toHaveLength(4);
    for (const item of graph.items) {
      Vitest.expect(item.definitions).toEqual([]);
      Vitest.expect(
        graph.dependencies(item.id).size + graph.dependents(item.id).size,
      ).toBe(0);
    }
  }
});

Vitest.test(
  "graph identity follows topology and freshness, not code, errors, or unrelated records",
  () => {
    const state = fixture();
    const view = observe(state);
    const graph = view.graph();
    const trace = graph.trace("source");
    // A fresh snapshot can carry new record identities without new dependencies.
    view.update({
      ...structuredClone(state),
      cells: {
        ...state.cells,
        source: { ...state.cells.source, code: "x = 2" },
      },
    });
    Vitest.expect(view.graph()).toBe(graph);
    Vitest.expect(view.graph().trace("source")).toBe(trace);
    view.update({
      ...state,
      analysis: {
        ...state.analysis,
        cells: {
          ...state.analysis.cells,
          isolated: { ...state.analysis.cells.isolated, refs: ["x"] },
        },
      },
    });
    Vitest.expect(view.graph()).not.toBe(graph);
    Vitest.expect(view.graph().trace("source")?.downstream.has("isolated")).toBe(true);
  },
);
