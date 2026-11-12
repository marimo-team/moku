# @momo/editor

A scoped editable notebook document with local drafts, synchronization, and CodeMirror bindings.

```ts
import { EditorView } from "@codemirror/view";
import * as CodeMirror from "@momo/editor/CodeMirror";
import type * as Document from "@momo/editor/Document";

function mountCell(document: Document.Interface, cellId: string, parent: HTMLElement) {
  return new EditorView({
    parent,
    extensions: [CodeMirror.bindCell({ document, cellId })],
  });
}
```

Create the document with `yield* Document.make(notebook)` in an editing scope,
then share it among cell editors. `Document.layer` instead consumes
`Notebook.Service` and provides `Document.Service`. Both use the notebook's
AtomRegistry.

Add your own CodeMirror themes, languages, completions, keymaps, and history
alongside the binding. It initializes raw cell source on the next microtask,
maps selections through host changes, and waits for IME composition to finish.
Missing source, permission loss, or document closure makes the editor read-only.
Destroying an EditorView releases its binding while leaving the draft alive.

You can edit the document without CodeMirror:

```ts
document.registry.set(document.edit, (transaction) => {
  transaction.setCode(cellId, "x = 1");
  transaction.updateConfig(cellId, { hide_code: true });
});
```

Transactions publish atomically; throwing rolls back the transaction. They also
support naming, creating, deleting, and reordering cells. `document`, `canEdit`,
`dirty`, and `status` are atoms for your view to observe.

Edits synchronize after 400 ms of inactivity. Run `document.flush` to synchronize
immediately and wait for confirmed edits, including newer typing. It does not save
to disk. Failed synchronization retains the draft for `document.retry`. Flush
before closing the editing scope if pending edits should be retained; closing
cancels synchronization.
