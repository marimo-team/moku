import { expect, test } from "vite-plus/test";
import { Effect } from "effect";
import type * as Notebook from "@moku/core/Notebook";
import type * as Document from "@moku/editor/Document";
import { runCell } from "../../src/plugins/basic/index.tsx";

function fixture(removed = false) {
  const calls: unknown[] = [];
  const notebook = {
    runtime: {
      start: () => Effect.die("Running a cell must not start the runtime"),
      run: (request: unknown) =>
        Effect.sync(() => {
          calls.push(request);
        }),
    },
  } as unknown as Notebook.Interface;
  const document = {
    flush: Effect.sync(() => ({
      cells: new Map(
        removed
          ? []
          : [["a", { id: "a", etag: "confirmed", config: { disabled: false } }]],
      ),
    })),
  } as unknown as Document.Interface;
  return { notebook, document, calls };
}

test("runs only the selected cell with its confirmed source without starting the runtime", async () => {
  const { notebook, document, calls } = fixture();
  await Effect.runPromise(runCell(notebook, document, "a"));
  expect(calls).toEqual([
    {
      requestId: expect.any(String),
      request: { cells: [{ id: "a", etag: "confirmed" }] },
    },
  ]);
});

test("does not execute a cell removed before edits were confirmed", async () => {
  const { notebook, document, calls } = fixture(true);
  await expect(Effect.runPromise(runCell(notebook, document, "a"))).rejects.toThrow(
    "removed or disabled",
  );
  expect(calls).toEqual([]);
});
