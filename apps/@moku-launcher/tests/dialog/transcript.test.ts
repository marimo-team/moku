import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as Vitest from "vite-plus/test";
import { Option } from "effect";
import * as Transcript from "../../src/plugins/dialog/transcript.ts";

const turn: Transcript.Turn = {
  prompt: 'Plot "revenue" by month\nwith a """docstring""" and C:\\path',
  reply: "Done ✅ — see `chart`.\u2028\t\u0000 Unicode: 日本語 😀 }\n}",
  cells: ["Hbol", "MJUe"],
};

Vitest.test("turns round-trip through cell source", () => {
  const code = Transcript.serialize(turn);
  NodeAssert.ok(Transcript.isDialog(code));
  NodeAssert.deepEqual(Option.getOrThrow(Transcript.parse(code)), turn);
  const waiting = { prompt: "hi", reply: "" };
  NodeAssert.deepEqual(
    Option.getOrThrow(Transcript.parse(Transcript.serialize(waiting))),
    waiting,
  );
});

Vitest.test("turn source tolerates Python formatting and rejects other edits", () => {
  const formatted = `# moku:dialog
import marimo as _mo

_turn = {
    "prompt": "a, }",
    "reply": "b",
    "cells": ["x",],
}
_mo.vstack([_mo.md(_turn["prompt"]).style({}), _mo.md(_turn["reply"])])
`;
  NodeAssert.deepEqual(Option.getOrThrow(Transcript.parse(formatted)), {
    prompt: "a, }",
    reply: "b",
    cells: ["x"],
  });
  NodeAssert.ok(Option.isNone(Transcript.parse('_turn = {\n    "prompt": "a",\n}')));
  const edited = formatted.replace('"b"', "'b'");
  NodeAssert.ok(Transcript.isDialog(edited));
  NodeAssert.ok(Option.isNone(Transcript.parse(edited)));
  NodeAssert.ok(
    Option.isNone(Transcript.parse(formatted.replace('"reply"', '"answer"'))),
  );
});

Vitest.test.skipIf(!process.env.MOKU_PYTHON)(
  "Python runs serialized turns and reads the same values",
  () => {
    // Set MOKU_PYTHON to an interpreter to compare string escapes with Python's.
    // marimo is stubbed so the test checks the cell's own code without a kernel.
    const harness = [
      "import json, sys, types",
      "class Html:",
      "    def __init__(self, text): self.text = text",
      "    def style(self, style=None, **kwargs): return self",
      "marimo = types.ModuleType('marimo')",
      "marimo.md = Html",
      "marimo.vstack = list",
      "sys.modules['marimo'] = marimo",
      "scope = {}",
      "exec(sys.stdin.read(), scope)",
      "sys.stdout.write(json.dumps(scope['_turn']))",
    ].join("\n");
    const output = NodeChildProcess.execFileSync(
      process.env.MOKU_PYTHON!,
      ["-c", harness],
      { encoding: "utf8", input: Transcript.serialize(turn) },
    );
    NodeAssert.deepEqual(JSON.parse(output), turn);
  },
);
