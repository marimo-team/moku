/**
 * Editor-owned document and actions for a notebook supplied by the launcher.
 *
 * @module
 */
import { Effect, Option } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Document from "@moku/editor/Document";
import type * as Notebook from "@moku/core/Notebook";
import * as Outputs from "./outputs.ts";
import { ensureRuntime } from "../../../app/execution.ts";

function make(notebook: Notebook.Interface) {
  return Effect.gen(function* () {
    const document = yield* Document.make(notebook);
    const registry = yield* AtomRegistry.AtomRegistry;
    const outputs = Atom.readable((get): Outputs.Selection =>
      Outputs.select(
        get(notebook.state).value,
        Option.getOrUndefined(get.self<Outputs.Selection>()),
      ),
    );
    const run = Atom.fn((input: { cellIds?: readonly string[] }) =>
      Effect.gen(function* () {
        yield* document.flush;
        if (!(yield* ensureRuntime(notebook))) return;
        const confirmed = yield* document.flush;
        const cells = yield* Effect.forEach(
          input.cellIds ?? confirmed.revision.order,
          (id) => {
            const cell = confirmed.cells.get(id);
            return cell
              ? Effect.succeed(cell)
              : Effect.fail(new Error("The cell was removed before it could run."));
          },
        );
        yield* notebook.runtime.run({
          requestId: crypto.randomUUID(),
          request: {
            cells: cells
              .filter((cell) => !cell.config.disabled)
              .map(({ id, etag }) => ({ id, etag })),
          },
        });
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
    return { document, outputs, run, save, interrupt, cancel };
  });
}

export const session = Atom.family((notebook: Notebook.Interface) =>
  Atom.make(make(notebook)).pipe(Atom.setIdleTTL(0)),
);
export type Session = Effect.Success<ReturnType<typeof make>>;
