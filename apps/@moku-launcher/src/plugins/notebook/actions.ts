/** Notebook commands, including draft synchronization before execution. @module */
import { Effect } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
import type * as Document from "@moku/editor/Document";

export function make(notebook: Notebook.Interface, document: Document.Interface) {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const run = Atom.fn((input: { cellIds?: readonly string[] }) =>
      Effect.gen(function* () {
        yield* document.flush;
        yield* notebook.ensureRunning;
        const confirmed = yield* document.flush;
        const cells =
          input.cellIds === undefined
            ? confirmed.cells
            : input.cellIds.map((id) => {
                const cell = confirmed.cells.find((cell) => cell.id === id);
                if (!cell) throw new Error("The cell was removed before it could run.");
                return cell;
              });
        return yield* notebook.runtime.run({ cells });
      }),
    );
    const save = Atom.fn(() =>
      Effect.gen(function* () {
        const confirmed = yield* document.flush;
        return yield* notebook.save(confirmed);
      }),
    );
    const interrupt = Atom.fn(() => notebook.runtime.interrupt());
    const cancel = Atom.fn(() =>
      Effect.gen(function* () {
        if (
          AsyncResult.getOrElse(registry.get(notebook.state), () => undefined)?.runtime
            ?.status !== "starting"
        )
          return;
        yield* notebook.runtime.stop();
      }),
    );
    return { run, save, interrupt, cancel };
  });
}
