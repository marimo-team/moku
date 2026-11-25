import * as Vitest from "vite-plus/test";
import { dataflow } from "../../src/plugins/drawing/wires.ts";

const cell = (name: string, defs: string[], refs: string[] = []) => ({
  name,
  defs,
  refs,
});

Vitest.test(
  "cards that read each other's globals are wired, through helper cells too",
  () => {
    const cells = [
      cell("setup", ["np", "mo"]),
      cell("amp", ["amp"], ["mo"]),
      cell("samples", ["samples"], ["np", "amp"]),
      cell("hist", [], ["samples"]),
      cell("stat", [], ["amp", "mo"]),
      cell("lonely", [], ["np"]),
    ];
    Vitest.expect(dataflow(cells, new Set(["amp", "hist", "stat", "lonely"]))).toEqual([
      { from: "amp", to: "stat", label: "amp" },
      { from: "amp", to: "hist", label: "amp via samples" },
    ]);
  },
);

Vitest.test("each pair gets one wire, labelled by the shortest path", () => {
  const cells = [
    cell("a", ["x", "y"]),
    cell("helper", ["z"], ["x"]),
    cell("b", [], ["y", "z", "x"]),
  ];
  Vitest.expect(dataflow(cells, new Set(["a", "b"]))).toEqual([
    { from: "a", to: "b", label: "x, y" },
  ]);
});
