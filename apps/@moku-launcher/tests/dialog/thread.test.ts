import * as NodeAssert from "node:assert/strict";
import * as Vitest from "vite-plus/test";
import * as Thread from "../../src/plugins/dialog/thread.ts";
import * as Transcript from "../../src/plugins/dialog/transcript.ts";

const turn = (prompt: string) => Transcript.serialize({ prompt, reply: "ok" });

function notebook(...cells: [id: string, code: string][]) {
  return {
    order: cells.map(([id]) => id),
    cells: new Map(cells.map(([id, code]) => [id, { code }])),
  };
}

const document = notebook(
  ["a", turn("first")],
  ["x", "x = 1"],
  ["y", "y = 2"],
  ["b", turn("second")],
  ["c", "# moku:dialog\nedited by hand"],
  ["z", "z = 3"],
);

Vitest.test("a turn's conversation is the turns above it", () => {
  NodeAssert.deepEqual(
    Thread.above(document, null).map((entry) => entry.turn.prompt),
    ["first", "second"],
  );
  NodeAssert.deepEqual(
    Thread.above(document, "y").map((entry) => entry.id),
    ["a"],
  );
  NodeAssert.deepEqual(
    Thread.above(document, "b").map((entry) => entry.id),
    ["a", "b"],
  );
});
