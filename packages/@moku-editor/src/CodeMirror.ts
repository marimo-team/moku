/**
 * CodeMirror extensions that bind a view to cell source in a document.
 *
 * @module
 */
import {
  Annotation,
  Compartment,
  EditorState,
  Transaction,
  type Extension,
} from "@codemirror/state";
import { diff } from "@codemirror/merge";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type * as Document from "./Document.ts";

/** Text shown by an editor and the conversion back to canonical cell source. */
export interface Source {
  readonly code: string;
  readonly write: (code: string) => string;
  readonly extension?: Extension;
}

export interface CellOptions {
  readonly document: Document.Interface;
  readonly cellId: string;
  /** Projects canonical source into an editable representation, such as Markdown. */
  readonly source?: (code: string) => Source;
}

const documentUpdate = Annotation.define<boolean>();

function readCode({ document, cellId }: CellOptions): string | null | undefined {
  return document.registry.get(document.state).document?.cells.get(cellId)?.code;
}

function project(options: CellOptions): Source {
  const code = readCode(options) ?? "";
  return options.source?.(code) ?? { code, write: (text) => text };
}

function canEdit(options: CellOptions): boolean {
  const { document } = options;
  return (
    document.registry.get(document.state).canEdit &&
    typeof readCode(options) === "string"
  );
}

function permissions(editable: boolean): Extension {
  return [
    EditorState.readOnly.of(!editable),
    EditorView.editable.of(editable),
    EditorView.contentAttributes.of({ "aria-readonly": String(!editable) }),
  ];
}

/**
 * Binds an editor view to one cell's source and edit permissions.
 *
 * The binding loads source on the next microtask and maps selections through
 * host changes. Source updates wait for IME composition to finish. Missing
 * source, permission loss, or document closure makes the view read-only.
 *
 * Add languages, themes, history, and keymaps alongside this extension.
 * An optional `source` projection can display Markdown or SQL while `write`
 * stores canonical Python. Keep projection extensions stable across calls.
 * Destroying the view releases its subscriptions and leaves the document alive.
 *
 * @example Mount a cell editor
 * ```ts
 * import { EditorView } from "@codemirror/view";
 * import * as CodeMirror from "@moku/editor/CodeMirror";
 * import type * as Document from "@moku/editor/Document";
 *
 * function mountCell(document: Document.Interface, cellId: string, parent: HTMLElement) {
 *   return new EditorView({
 *     parent,
 *     extensions: [CodeMirror.bindCell({ document, cellId })],
 *   });
 * }
 * ```
 */
export function bindCell(options: CellOptions): Extension {
  const editable = new Compartment();
  const source = new Compartment();

  return [
    editable.of(permissions(canEdit(options))),
    source.of([]),
    EditorState.transactionFilter.of((transaction) => {
      if (!transaction.docChanged || transaction.annotation(documentUpdate)) {
        return transaction;
      }

      // A pending source update must reach the view before it can be edited.
      const matchesSource =
        project(options).code === transaction.startState.doc.toString();
      return canEdit(options) && matchesSource ? transaction : [];
    }),
    ViewPlugin.define((view) => new CellBinding(view, options, editable, source), {
      eventObservers: {
        compositionend() {
          this.compositionEnded();
        },
      },
    }),
  ];
}

class CellBinding {
  private scheduled = false;
  private waitingForComposition = false;
  private destroyed = false;
  private editable: boolean | undefined;
  private extension: Extension | undefined;
  private compositionTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly stopDocument: () => void;

  constructor(
    private readonly view: EditorView,
    private readonly options: CellOptions,
    private readonly permissionCompartment: Compartment,
    private readonly sourceCompartment: Compartment,
  ) {
    const { document } = options;
    this.stopDocument = document.registry.subscribe(document.state, () => {
      this.schedulePull();
    });
    this.schedulePull();
  }

  update(update: ViewUpdate): void {
    const fromDocument = update.transactions.every((transaction) =>
      transaction.annotation(documentUpdate),
    );

    if (update.docChanged && !fromDocument) {
      this.publishEdit(update);
      this.schedulePull();
    }

    if (this.waitingForComposition && !this.view.composing) {
      this.schedulePull();
    }
  }

  private publishEdit(update: ViewUpdate): void {
    const { document, cellId } = this.options;
    const source = project(this.options);
    const matchesSource = source.code === update.startState.doc.toString();

    // Also enforce permissions for callers that dispatch with filtering disabled.
    if (!canEdit(this.options) || !matchesSource) {
      return;
    }

    document.edit((transaction) => {
      transaction.setCode(cellId, source.write(update.state.doc.toString()));
    });
  }

  private schedulePull(): void {
    if (this.destroyed || this.scheduled) {
      return;
    }

    this.scheduled = true;
    queueMicrotask(() => this.pullDocument());
  }

  private pullDocument(): void {
    this.scheduled = false;
    if (this.destroyed) {
      return;
    }

    const editable = canEdit(this.options);
    const effects = [];
    if (editable !== this.editable) {
      effects.push(this.permissionCompartment.reconfigure(permissions(editable)));
      this.editable = editable;
    }

    this.waitingForComposition = this.view.composing;
    const previous = this.view.state.doc.toString();
    const source = project(this.options);
    const next = source.code;
    if (source.extension !== this.extension) {
      effects.push(this.sourceCompartment.reconfigure(source.extension ?? []));
      this.extension = source.extension;
    }
    const changes = this.waitingForComposition
      ? []
      : diff(previous, next, { scanLimit: 500 }).map((change) => ({
          from: change.fromA,
          to: change.toA,
          insert: next.slice(change.fromB, change.toB),
        }));

    if (changes.length === 0 && effects.length === 0) {
      return;
    }

    this.view.dispatch({
      changes,
      effects,
      filter: false,
      annotations: [
        documentUpdate.of(true),
        Transaction.remote.of(true),
        Transaction.addToHistory.of(false),
      ],
    });
  }

  compositionEnded(): void {
    if (!this.waitingForComposition || this.destroyed) {
      return;
    }

    // CodeMirror finishes composition after the DOM event, even without an edit.
    clearTimeout(this.compositionTimer);
    this.compositionTimer = setTimeout(() => this.schedulePull(), 0);
  }

  destroy(): void {
    this.destroyed = true;
    clearTimeout(this.compositionTimer);
    this.stopDocument();
  }
}
