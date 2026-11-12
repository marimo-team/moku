# @momo/editor

A scoped editable notebook document with local drafts, reactive state, and synchronization.

```ts
import * as Document from "@momo/editor/Document";

Document.make(notebook); // scoped Effect constructing an Interface
Document.Service; // Context.Service for the current editing session
Document.layer; // provides Service; requires Notebook.Service and its AtomRegistry

// Public types:
// Document.Interface
// Document.Edit
// Document.Editor
// Document.EditableDocument
// Document.EditableCell
// Document.SyncStatus
// Document.SyncError

// In an Effect: const document = yield* Document.Service;

document.document; // editable snapshot atom: order + cells, or null while unavailable
document.canEdit; // edit availability atom
document.dirty; // pending local changes atom
document.status; // idle | pending | sending | confirming | unavailable | error
document.edit; // writable synchronous transaction atom
document.flush; // Effect: await confirmed edits, including newer typing; does not save
document.retry; // Effect: retry synchronization while preserving the draft

registry.set(document.edit, (tx) => {
  tx.setCode(cellId, "x = 1");
  tx.setName(cellId, "example");
  tx.updateConfig(cellId, { hide_code: true }); // omitted settings are preserved
  tx.createCell({ id: newCellId, code: "x + 1" }, { after: cellId });
  tx.setOrder([newCellId, cellId]); // every cell exactly once
  tx.deleteCell(newCellId);
});

// Transactions publish together; throwing rolls back the whole transaction.
// Edits synchronize after 400 ms of inactivity; flush bypasses the delay.
// HTTP acceptance and a matching or newer streamed revision confirm an edit.
// Failed synchronization retains the draft for explicit retry.
// Each make() owns a draft; share its returned document among cell editors.
// Flush before closing its scope to retain edits. Closing cancels synchronization.
// CodeMirror bindings are not implemented yet.
```
