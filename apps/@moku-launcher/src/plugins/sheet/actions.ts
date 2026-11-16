/**
 * Sheet commands. Editing a grid cell rewrites the marimo cell behind it and
 * asks the host to run that cell. The host decides what else must run.
 *
 * @module
 */
import { Effect } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
import type * as Document from "@moku/editor/Document";
import { empty } from "../empty.ts";
import type * as Address from "./address.ts";
import * as Formula from "./formula.ts";
import * as Layout from "./layout.ts";

/** Creates the sheet's commands for one notebook and its draft document. */
export function make(notebook: Notebook.Interface, document: Document.Interface) {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const snapshot = () =>
      AsyncResult.getOrElse(registry.get(notebook.state), () => empty);

    // Cells edited here that the host has not been asked to run yet. A newer
    // evaluation interrupts an older one, so requests are kept until one succeeds.
    const edited = new Set<string>();

    /**
     * Writes typed input to an address and reports whether anything changed.
     *
     * Blank input removes the cell. Its dependents are marked for evaluation so
     * they report the missing name instead of keeping a value that no longer holds.
     */
    function write(address: string, input: string): boolean {
      const draft = registry.get(document.state);
      if (!draft.canEdit) return false;
      const existing = Layout.of(draft.document).cells.get(address);
      const code = Formula.toSource(address, input);
      if (code === null) {
        if (!existing) return false;
        const analysis = snapshot().analysis?.cells ?? {};
        for (const [id, cell] of Object.entries(analysis))
          if (id !== existing.id && cell.refs.includes(address)) edited.add(id);
        document.edit((edit) => edit.deleteCell(existing.id));
        return true;
      }
      if (existing) {
        if (existing.code === code) return false;
        document.edit((edit) => edit.setCode(existing.id, code));
        edited.add(existing.id);
        return true;
      }
      document.edit((edit) => {
        edited.add(edit.createCell({ code, name: address }));
      });
      return true;
    }

    /** Adds a cell that is not on the grid, such as an import, and returns its id. */
    function addCell(code: string): string | null {
      if (!registry.get(document.state).canEdit) return null;
      let id: string | null = null;
      document.edit((edit) => {
        id = edit.createCell({ code });
      });
      if (id !== null) edited.add(id);
      return id;
    }

    function names(): Set<string> {
      const draft = registry.get(document.state).document;
      return new Set([...(draft?.cells.values() ?? [])].map((cell) => cell.name));
    }

    /**
     * Adds a chart pinned at the anchor and returns its id.
     *
     * The chart's code is ordinary Python whose output floats over the grid. When
     * no cell imports pyplot as `plt`, an import cell is added before it.
     */
    function addChart(anchor: Address.Position, code: string): string | null {
      if (!registry.get(document.state).canEdit) return null;
      const analysis = snapshot().analysis?.cells ?? {};
      const imported = Object.values(analysis).some((cell) =>
        cell.defs.includes("plt"),
      );
      const name = Layout.chartName(anchor, names());
      let id: string | null = null;
      document.edit((edit) => {
        if (!imported)
          edited.add(edit.createCell({ code: "import matplotlib.pyplot as plt" }));
        id = edit.createCell({ code, name });
      });
      if (id !== null) edited.add(id);
      return id;
    }

    /**
     * Pins a chart at another address by renaming it.
     *
     * Nothing reads a chart, so the rename needs no evaluation.
     */
    function moveChart(cellId: string, anchor: Address.Position): void {
      if (!registry.get(document.state).canEdit) return;
      const taken = names();
      const current = registry.get(document.state).document?.cells.get(cellId)?.name;
      if (current) taken.delete(current);
      const name = Layout.chartName(anchor, taken);
      if (name !== current) document.edit((edit) => edit.setName(cellId, name));
    }

    /** Deletes a cell that is not on the grid, such as a chart. */
    function remove(cellId: string): void {
      if (!registry.get(document.state).canEdit) return;
      document.edit((edit) => edit.deleteCell(cellId));
      edited.delete(cellId);
    }

    /** Marks a cell edited as Python for the next evaluation. */
    function touch(cellId: string): void {
      edited.add(cellId);
    }

    /**
     * Sends pending edits and runs the edited cells, starting a runtime if needed.
     *
     * A runtime that has evaluated nothing runs the whole sheet, because an
     * edited cell may read values that do not exist yet.
     */
    const evaluate = Atom.fn((input: { readonly all?: boolean }) =>
      Effect.gen(function* () {
        yield* document.flush;
        yield* notebook.ensureRunning;
        const confirmed = yield* document.flush;
        const state = snapshot();
        const started = Object.values(state.executions).some(
          (execution) =>
            execution.cell_id !== null && execution.runtime_id === state.runtime?.id,
        );
        const cells =
          input.all || !started
            ? confirmed.cells
            : confirmed.cells.filter((cell) => edited.has(cell.id));
        const enabled = cells.filter((cell) => !cell.config.disabled);
        if (enabled.length > 0) yield* notebook.runtime.run({ cells: enabled });
        const present = new Set<string>(confirmed.cells.map((cell) => cell.id));
        const submitted = new Set<string>(cells.map((cell) => cell.id));
        for (const id of edited)
          if (submitted.has(id) || !present.has(id)) edited.delete(id);
      }),
    );

    const save = Atom.fn(() =>
      Effect.gen(function* () {
        const confirmed = yield* document.flush;
        return yield* notebook.save(confirmed);
      }),
    );

    return { write, addCell, addChart, moveChart, remove, touch, evaluate, save };
  });
}
