/** Notebook commands, including draft synchronization before execution. @module */
import { Effect } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
import type * as Document from "@moku/editor/Document";
import * as Runtime from "@moku/core/Runtime";
import * as Run from "../../app/Run.ts";

export function make(notebook: Notebook.Interface, document: Document.Interface) {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const run = Atom.fn((input: { cellIds?: readonly string[] }) =>
      Effect.gen(function* () {
        yield* document.flush;
        if (!(yield* Runtime.ensureRunning(notebook))) return;
        const confirmed = yield* document.flush;
        yield* Run.cells(notebook, input.cellIds ?? confirmed.revision.order, (id) =>
          confirmed.cells.get(id),
        );
      }),
    );
    const save = Atom.fn(() =>
      Effect.gen(function* () {
        const confirmed = yield* document.flush;
        return yield* notebook.save({
          etag: confirmed.revision.etag,
          requestId: crypto.randomUUID(),
        });
      }),
    );
    const interrupt = Atom.fn(() =>
      notebook.runtime.interrupt({ requestId: crypto.randomUUID() }),
    );
    const cancel = Atom.fn(() =>
      Effect.gen(function* () {
        if (registry.get(notebook.state).value.runtime?.status !== "starting") return;
        yield* notebook.runtime.stop({ requestId: crypto.randomUUID() });
      }),
    );
    return { run, save, interrupt, cancel };
  });
}
