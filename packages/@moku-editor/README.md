# @moku/editor

A shared notebook draft that synchronizes edits to marimo and binds cells to CodeMirror.

```ts
import { Effect } from "effect";
import { EditorView } from "@codemirror/view";
import * as Notebook from "@moku/model/Notebook";
import * as Document from "@moku/editor/Document";
import * as CodeMirror from "@moku/editor/CodeMirror";

const editing = Effect.gen(function* () {
  const notebook = yield* Notebook.Service;
  return yield* Document.make(notebook);
});

function mountCell(document: Document.Interface, cellId: string, parent: HTMLElement) {
  return new EditorView({
    parent,
    extensions: [CodeMirror.bindCell({ document, cellId })],
  });
}
```

Share one `Document.Interface` and the notebook's registry across cell editors.
`document.edit` applies draft changes; `document.state` exposes the draft and sync status.
Edits synchronize automatically. `document.flush` waits for confirmation without saving to disk.
