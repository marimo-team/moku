/**
 * Local notebook drafts with automatic synchronization to the host.
 *
 * Share one document across the cell editors in an editing session. The document
 * uses the notebook's AtomRegistry and lives until its Effect scope closes.
 *
 * @module
 */
import { Context, Effect, Layer, type Scope } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Notebook from "@moku/core/Notebook";
import { makeState } from "./internal/state.ts";
import { synchronize, type SyncStatus, type SyncError } from "./internal/sync.ts";
import * as Source from "./internal/source.ts";
import * as Draft from "./internal/draft.ts";
import type { Edit } from "./internal/edit.ts";

export type { EditableDocument, EditableCell } from "./internal/draft.ts";
export type { Edit, Editor } from "./internal/edit.ts";
export { SyncError } from "./internal/sync.ts";
export type { SyncStatus };

/**
 * The editable snapshot, permissions, and synchronization progress.
 */
export interface State {
  /**
   * Confirmed source with local edits applied, or null before source arrives.
   */
  readonly document: Draft.EditableDocument | null;

  /**
   * Whether the source is editable and this document is still open.
   */
  readonly canEdit: boolean;

  /**
   * Whether local edits remain unconfirmed by the host.
   */
  readonly dirty: boolean;

  /**
   * Synchronization progress or the failure that needs attention.
   */
  readonly status: SyncStatus;
}

/**
 * Local edits layered over one notebook's confirmed document.
 */
export interface Interface {
  /**
   * The registry that owns this document and its notebook state.
   */
  readonly registry: AtomRegistry.AtomRegistry;

  /**
   * Read-only state. Select fields to observe only the changes a view needs.
   *
   * @example Read pending changes in React
   * ```tsx
   * const dirty = useAtomValue(document.state, (state) => state.dirty);
   * ```
   */
  readonly state: Atom.Atom<State>;

  /**
   * Applies a synchronous transaction to the draft.
   *
   * The changes publish together when the callback returns. Throwing rolls back
   * the transaction. Edits are ignored while `state.canEdit` is false.
   *
   * @example Change cell source and configuration together
   * ```ts
   * import type * as Document from "@moku/editor/Document";
   *
   * function updateCell(document: Document.Interface, cellId: string) {
   *   document.edit((edit) => {
   *     edit.setCode(cellId, "x = 1");
   *     edit.updateConfig(cellId, { hide_code: true });
   *   });
   * }
   * ```
   */
  readonly edit: (edit: Edit) => void;

  /**
   * Sends pending edits and waits for confirmation, including newer typing.
   *
   * This updates the host document without saving it to disk. Concurrent callers
   * share synchronization; interrupting a caller does not cancel the write.
   */
  readonly flush: Effect.Effect<Notebook.Document, SyncError>;

  /**
   * Retries failed synchronization while preserving the local draft.
   */
  readonly retry: Effect.Effect<Notebook.Document, SyncError>;
}

/**
 * The editable document supplied to an Effect program.
 */
export class Service extends Context.Service<Service, Interface>()("@moku/Document") {}

/**
 * Creates an editable document for a notebook.
 *
 * Edits synchronize after 400 ms of inactivity. Use `flush` to send them sooner
 * and wait for confirmation. Failures leave the draft available for `retry`.
 *
 * Use the same AtomRegistry as the notebook. Keep the scope alive across cell
 * editor mounts; closing it cancels synchronization. Flush before closing if
 * pending edits must reach the host.
 *
 * @example Acquire a document for the current notebook
 * ```ts
 * import { Effect } from "effect";
 * import * as Document from "@moku/editor/Document";
 *
 * const editing = Effect.gen(function* () {
 *   return yield* Document.make(notebook);
 * });
 * ```
 */
export function make(
  notebook: Notebook.Interface,
): Effect.Effect<Interface, never, Scope.Scope | AtomRegistry.AtomRegistry> {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    let previous: Notebook.Document | null = null;
    let confirmed: Source.Confirmed | null = null;
    const source = Atom.readable((get): Source.Source => {
      const result = get(notebook.state);
      const state = AsyncResult.getOrElse(result, () => undefined);
      const document = state?.document ?? null;
      if (document !== previous) {
        previous = document;
        confirmed = document
          ? {
              revision: document,
              cells: new Map(document.cells.map((cell) => [cell.id, cell])),
            }
          : null;
      }
      return {
        document: confirmed,
        canEdit:
          AsyncResult.isSuccess(result) &&
          !result.waiting &&
          state?.notebook?.operations.includes("notebook.edit") === true &&
          confirmed !== null,
      };
    });
    const model = yield* Effect.acquireRelease(
      Effect.sync(() => makeState(registry, source, notebook.id)),
      (model) => Effect.sync(() => model.dispose()),
    );
    const sync = yield* synchronize(model, registry, notebook);
    const snapshot = Atom.readable((get): Omit<State, "status"> => {
      const { source, draft } = get(model.state);
      return {
        document: source.document ? Draft.viewDocument(source.document, draft) : null,
        canEdit: source.canEdit,
        dirty: !Draft.isEmptyDraft(draft),
      };
    });
    return Service.of({
      registry,
      state: Atom.readable((get): State => ({
        ...get(snapshot),
        status: get(sync.status),
      })),
      edit: (edit) => registry.set(model.edit, edit),
      flush: sync.flush.pipe(Effect.map(Source.document)),
      retry: sync.retry.pipe(Effect.map(Source.document)),
    });
  });
}

/** Provides an editor for an attached notebook. */
export const layer = (notebook: Notebook.Interface) =>
  Layer.effect(Service, make(notebook));
