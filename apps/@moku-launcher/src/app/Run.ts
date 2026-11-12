import { Effect } from "effect";
import type * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/Protocol";

type Cell = Pick<Protocol.CellOutput, "id" | "etag" | "config">;

/** Submit enabled cells in the requested order using their confirmed etags. */
export function cells(
  notebook: Notebook.Interface,
  ids: readonly string[],
  lookup: (id: string) => Cell | undefined,
) {
  return Effect.gen(function* () {
    const cells: Protocol.RunRequest["cells"] = [];
    for (const id of ids) {
      const cell = lookup(id);
      if (!cell)
        return yield* Effect.fail(
          new Error("The cell was removed before it could run."),
        );
      if (!cell.config.disabled) cells.push({ id: cell.id, etag: cell.etag });
    }
    return yield* notebook.runtime.run({
      requestId: crypto.randomUUID(),
      request: { cells },
    });
  });
}
