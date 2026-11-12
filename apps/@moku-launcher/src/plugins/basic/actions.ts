import { Effect } from "effect";
import type { ViewProps } from "@moku/plugin";
import type * as Document from "@moku/editor/Document";
import * as Run from "../../app/Run.ts";

/** Flush edits first so execution uses the source currently shown in the editor. */
export function runCell(
  notebook: ViewProps["notebook"],
  document: Document.Interface,
  cellId: string,
) {
  return Effect.gen(function* () {
    const confirmed = yield* document.flush;
    const cell = confirmed.cells.get(cellId);
    if (!cell || cell.config.disabled)
      return yield* Effect.fail(
        new Error("The selected cell was removed or disabled."),
      );
    return yield* Run.cells(notebook, [cellId], (id) => confirmed.cells.get(id));
  });
}
