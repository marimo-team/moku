import * as Vitest from "vite-plus/test";
import { Graph } from "../src/graph.ts";

Vitest.test("direct edges and transitive dependencies stay distinct", () => {
  const graph = new Graph(
    [
      { id: "result", definitions: [], references: ["y"], parents: ["middle"] },
      { id: "source", definitions: ["x"], references: [], parents: [] },
      { id: "middle", definitions: ["y"], references: ["x"], parents: ["source"] },
    ],
    true,
  );
  Vitest.expect(graph.dependencies("result")).toEqual(new Set(["middle"]));
  Vitest.expect(graph.dependents("source")).toEqual(new Set(["middle"]));
  Vitest.expect(graph.trace("result")?.upstream).toEqual(new Set(["middle", "source"]));
  Vitest.expect(graph.trace("source")?.downstream).toEqual(
    new Set(["middle", "result"]),
  );
});

Vitest.test("tracing a cycle excludes the starting cell", () => {
  const graph = new Graph(
    [
      { id: "a", definitions: ["x"], references: ["y"], parents: ["b"] },
      { id: "b", definitions: ["y"], references: ["x"], parents: ["a"] },
    ],
    true,
  );
  Vitest.expect(graph.dependencies("a")).toEqual(new Set(["b"]));
  Vitest.expect(graph.trace("a")).toEqual({
    upstream: new Set(["b"]),
    downstream: new Set(["b"]),
  });
  Vitest.expect(graph.trace("missing")).toBeUndefined();
});
