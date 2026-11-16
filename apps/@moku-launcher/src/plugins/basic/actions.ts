import { Effect } from "effect";
import type { ViewProps } from "@moku/plugin";
import type * as Document from "@moku/editor/Document";

/** Flush edits first so execution uses the source currently shown in the editor. */
export function runCell(
  notebook: Pick<ViewProps["notebook"], "runtime">,
  document: Pick<Document.Interface, "flush">,
  cellId: string,
) {
  return Effect.gen(function* () {
    const confirmed = yield* document.flush;
    const cell = confirmed.cells.find((cell) => cell.id === cellId);
    if (!cell) return yield* Effect.fail(new Error("The selected cell was removed."));
    return yield* notebook.runtime.run({ cells: [cell] });
  });
}
