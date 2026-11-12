# @momo/editor

A headless editable notebook document with drafts, synchronization, reactive state, and optional CodeMirror bindings.

```ts
import * as Document from "@momo/editor/Document";
import * as CodeMirror from "@momo/editor/CodeMirror";

// Proposed exports; not implemented yet.

Document.make(notebook); // scoped editable document; registry comes from Effect context

// Public types:
// Document.Document
// Document.Edit
// Document.EditableDocument
// Document.EditableCell
// Document.SyncStatus
// Document.SyncError

// The returned document exposes its state and actions:
document.document; // editable snapshot atom
document.canEdit; // edit availability atom
document.dirty; // pending local changes atom
document.status; // synchronization status atom
document.edit; // writable transaction atom
document.flush; // Effect: await confirmed edits; does not save to disk
document.retry; // Effect: retry synchronization

CodeMirror.bindCell({ document, cellId }); // CodeMirror Extension

// Add the binding alongside your own themes, completions, and keymaps.
// Destroying a cell's EditorView releases its binding, not the document.
```
