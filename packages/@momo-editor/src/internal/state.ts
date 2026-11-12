/**
 * Reconcile confirmed source, local drafts, and the submission awaiting confirmation.
 *
 * @module
 */
import type { Source } from "@momo/model/Notebook";
import type * as Protocol from "@momo/model/Protocol";
import { Atom, type AtomRegistry } from "effect/reactivity";
import * as Draft from "./draft.ts";
import { editDocument, type Edit } from "./edit.ts";

/**
 * The captured draft and immutable request for one synchronization attempt.
 */
export interface Submission {
  readonly request: Protocol.EditRequest;
  readonly draft: Draft.Draft;
  readonly response: Protocol.DocumentOutput | null;
}

interface State {
  readonly source: Source;
  readonly draft: Draft.Draft;
  readonly pending: Submission | null;
}

export interface Interface {
  readonly state: Atom.Atom<State>;
  readonly document: Atom.Atom<Draft.EditableDocument | null>;
  readonly canEdit: Atom.Atom<boolean>;
  readonly dirty: Atom.Atom<boolean>;
  readonly edit: Atom.Writable<void, Edit>;
  readonly get: () => State;
  readonly capture: () => Submission | null;
  readonly settle: (
    submission: Submission,
    response: Protocol.DocumentOutput | null,
  ) => void;
  readonly dispose: () => void;
}

function reconcile(state: State): State {
  const confirmed = state.source.document;
  if (!confirmed) return state;
  const response = state.pending?.response;
  if (response && confirmed.revision.version >= response.version) {
    state = {
      ...state,
      draft: Draft.acknowledge(state.draft, state.pending!.draft),
      pending: null,
    };
  }
  return {
    ...state,
    draft: Draft.prune(confirmed, state.draft, state.pending?.draft),
  };
}

/**
 * Creates document atoms and subscribes them to confirmed source.
 *
 * Call `dispose` when the editing session ends to release the subscription and
 * make the document read-only.
 */
export function makeState(
  registry: AtomRegistry.AtomRegistry,
  source: Atom.Atom<Source>,
  notebookId: string,
): Interface {
  const initial = registry.get(source);
  if (initial.document && initial.document.revision.notebook_id !== notebookId) {
    throw new Error("Document source belongs to another notebook");
  }
  const state = Atom.make<State>({
    source: initial,
    draft: Draft.EMPTY_DRAFT,
    pending: null,
  });
  const unmount = registry.mount(state);
  let closed = false;
  let editing = false;
  const unsubscribe = registry.subscribe(source, (next) => {
    if (next.document && next.document.revision.notebook_id !== notebookId) {
      throw new Error("Document source belongs to another notebook");
    }
    registry.update(state, (current) =>
      current.source.document === next.document &&
      current.source.canEdit === next.canEdit
        ? current
        : reconcile({ ...current, source: next }),
    );
  });

  const document = Atom.make((get) => {
    const current = get(state);
    return current.source.document
      ? Draft.viewDocument(current.source.document, current.draft)
      : null;
  });
  const canEdit = Atom.make((get) => !closed && get(state).source.canEdit);
  const dirty = Atom.make((get) => !Draft.isEmptyDraft(get(state).draft));
  const edit = Atom.writable(
    () => undefined,
    (ctx, edit: Edit) => {
      if (editing) throw new Error("Document transactions cannot be nested");
      const current = ctx.get(state);
      if (closed || !current.source.document || !current.source.canEdit) return;
      editing = true;
      try {
        const draft = editDocument(
          current.source.document,
          current.draft,
          edit,
          current.pending?.draft,
        );
        if (closed || ctx.get(state) !== current) {
          throw new Error("The document changed during the transaction");
        }
        if (draft !== current.draft) ctx.set(state, { ...current, draft });
      } finally {
        editing = false;
      }
    },
  );

  return {
    state,
    document,
    canEdit,
    dirty,
    edit,
    get: () => registry.get(state),
    capture(): Submission | null {
      const current = registry.get(state);
      if (!current.source.document || !current.source.canEdit || current.pending)
        return null;
      const changes = Draft.toChanges(current.source.document, current.draft);
      if (changes === null) return null;
      if (changes.length === 0) {
        if (!Draft.isEmptyDraft(current.draft)) {
          registry.set(state, { ...current, draft: Draft.EMPTY_DRAFT });
        }
        return null;
      }
      const pending = {
        request: { changes },
        draft: current.draft,
        response: null,
      };
      registry.set(state, { ...current, pending });
      return pending;
    },
    settle(submission: Submission, response: Protocol.DocumentOutput | null) {
      const current = registry.get(state);
      if (closed || current.pending?.request !== submission.request) return;
      if (response && response.notebook_id !== notebookId) {
        throw new Error("Edit response belongs to another notebook");
      }
      registry.set(
        state,
        reconcile({
          ...current,
          pending: response ? { ...submission, response } : null,
        }),
      );
    },
    dispose() {
      closed = true;
      unsubscribe();
      registry.update(state, (current) => ({
        ...current,
        source: { ...current.source, canEdit: false },
      }));
      unmount();
    },
  };
}
