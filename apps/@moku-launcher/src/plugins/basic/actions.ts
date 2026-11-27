import type * as Document from "@moku/editor/Document";
import type { ViewProps } from "@moku/plugin";
import { Effect } from "effect";

/** Flush edits first so execution uses the source currently shown in the editor. */
export function runCell(
  notebook: { readonly runtime: Pick<ViewProps["notebook"]["runtime"], "run"> },
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
