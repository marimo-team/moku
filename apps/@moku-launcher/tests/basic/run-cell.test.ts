import * as Vitest from "vite-plus/test";
import { Effect } from "effect";
import * as Protocol from "@moku/core/Protocol";
import {
  cell,
  document as revision,
} from "../../../../packages/@moku-editor/tests/fixture.ts";
import { Schema } from "effect";
import type * as Document from "@moku/editor/Document";
import { runCell } from "../../src/plugins/basic/actions.ts";

function fixture(removed = false) {
  const calls: unknown[] = [];
  const unused = () => Effect.die("Unexpected operation");
  const notebook = {
    runtime: {
      restart: unused,
      stop: unused,
      interrupt: unused,
      execute: unused,
      cancel: unused,
      reply: unused,
      start: () => Effect.die("Running a cell must not start the runtime"),
      run: (request: unknown) =>
        Effect.sync(() => {
          calls.push(request);
          return Schema.decodeUnknownSync(Protocol.Run)({
            id: "r",
            notebook_id: "n",
            runtime_id: "rt",
            cells: ["a"],
            status: "queued",
            outcome: null,
            started_at: null,
            completed_at: null,
          });
        }),
    },
  };
  const document = {
    flush: Effect.sync(() => ({
      ...revision,
      cells: removed ? [] : [cell],
    })),
  } satisfies Pick<Document.Interface, "flush">;
  return { notebook, document, calls };
}

Vitest.test(
  "runs only the selected cell with its confirmed source without starting the runtime",
  async () => {
    const { notebook, document, calls } = fixture();
    await Effect.runPromise(runCell(notebook, document, "a"));
    Vitest.expect(calls).toEqual([
      {
        cells: [cell],
      },
    ]);
  },
);

Vitest.test("does not execute a cell removed before edits were confirmed", async () => {
  const { notebook, document, calls } = fixture(true);
  await Vitest.expect(
    Effect.runPromise(runCell(notebook, document, "a")),
  ).rejects.toThrow("removed");
  Vitest.expect(calls).toEqual([]);
});
