import { Context, Effect, Layer, type Scope } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Notebook from "@momo/model/Notebook";
import { makeState } from "./internal/state.ts";
import { synchronize, type SyncStatus, type SyncError } from "./internal/sync.ts";
import type { EditableDocument } from "./internal/draft.ts";
import type { Edit } from "./internal/edit.ts";

export type { EditableDocument, EditableCell } from "./internal/draft.ts";
export type { Edit, Editor } from "./internal/edit.ts";
export { SyncError } from "./internal/sync.ts";
export type { SyncStatus };

/** Local edits layered over one notebook's confirmed document. */
export interface Interface {
  readonly document: Atom.Atom<EditableDocument | null>;
  readonly canEdit: Atom.Atom<boolean>;
  readonly dirty: Atom.Atom<boolean>;
  readonly edit: Atom.Writable<void, Edit>;
  readonly status: Atom.Atom<SyncStatus>;
  /** Waits for all pending typing to be confirmed; does not save to disk. */
  readonly flush: Effect.Effect<Notebook.Confirmed, SyncError>;
  readonly retry: Effect.Effect<Notebook.Confirmed, SyncError>;
}

export class Service extends Context.Service<Service, Interface>()("@momo/Document") {}

/** Keep this scope alive for the editing session, across individual cell editors. */
export function make(
  notebook: Notebook.Interface,
): Effect.Effect<Interface, never, Scope.Scope | AtomRegistry.AtomRegistry> {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const model = yield* Effect.acquireRelease(
      Effect.sync(() =>
        makeState(registry, notebook.source, notebook.target.notebookId),
      ),
      (model) => Effect.sync(() => model.dispose()),
    );
    const sync = yield* synchronize(model, registry, notebook);
    return Service.of({
      document: model.document,
      canEdit: model.canEdit,
      dirty: model.dirty,
      edit: model.edit,
      ...sync,
    });
  });
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const notebook = yield* Notebook.Service;
    return yield* make(notebook);
  }),
);
