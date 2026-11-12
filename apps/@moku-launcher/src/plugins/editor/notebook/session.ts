/**
 * Editor-owned document and actions for a notebook supplied by the launcher.
 *
 * @module
 */
import { Effect } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Document from "@moku/editor/Document";
import type * as Notebook from "@moku/core/Notebook";
import * as Outputs from "./outputs.ts";

function make(notebook: Notebook.Interface) {
  return Effect.gen(function* () {
    const document = yield* Document.make(notebook);
    const registry = yield* AtomRegistry.AtomRegistry;
    const outputs = Atom.readable((get): Outputs.Selection => Outputs.select(get(notebook.state).value, get.self<Outputs.Selection>()));
    const ready = (id: string) => Effect.callback<boolean, Error>((resume) => {
      let seen = false;
      return Effect.sync(registry.subscribe(notebook.state, (state) => {
        const runtime = state.value.runtime;
        if (runtime?.id === id) {
          seen = true;
          if (runtime.status === "running") resume(Effect.succeed(true));
          else if (runtime.status === "terminating") resume(Effect.succeed(false));
          else if (runtime.status !== "starting") resume(Effect.fail(new Error(runtime.message ?? "The runtime could not start.")));
        } else if (seen && state.value.ready) resume(Effect.succeed(false));
        if (state.error) resume(Effect.fail(state.error));
      }, { immediate: true }));
    }).pipe(Effect.timeout("60 seconds"));
    const run = Atom.fn((input: { cellIds?: readonly string[] }) => Effect.gen(function* () {
      yield* document.flush;
      const state = registry.get(notebook.state).value;
      if (state.runtime?.status !== "running") {
        const started = yield* notebook.runtime.start({ requestId: crypto.randomUUID() });
        if (started.status !== "running" && !(yield* ready(started.id))) return;
      }
      const confirmed = yield* document.flush;
      const cells = yield* Effect.forEach(input.cellIds ?? confirmed.revision.order, (id) => {
        const cell = confirmed.cells.get(id);
        return cell ? Effect.succeed(cell) : Effect.fail(new Error("The cell was removed before it could run."));
      });
      yield* notebook.runtime.run({
        requestId: crypto.randomUUID(),
        request: { cells: cells.filter((cell) => !cell.config.disabled).map(({ id, etag }) => ({ id, etag })) },
      });
    }));
    const save = Atom.fn(() => Effect.gen(function* () {
      const confirmed = yield* document.flush;
      return yield* notebook.save({ etag: confirmed.revision.etag, requestId: crypto.randomUUID() });
    }));
    const interrupt = Atom.fn(() => notebook.runtime.interrupt({ requestId: crypto.randomUUID() }));
    const cancel = Atom.fn(() => Effect.gen(function* () {
      if (registry.get(notebook.state).value.runtime?.status !== "starting") return;
      yield* notebook.runtime.stop({ requestId: crypto.randomUUID() });
    }));
    return { document, outputs, run, save, interrupt, cancel };
  });
}

export const session = Atom.family((notebook: Notebook.Interface) => Atom.make(make(notebook)).pipe(Atom.setIdleTTL(0)));
export type Session = Effect.Success<ReturnType<typeof make>>;
