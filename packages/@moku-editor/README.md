# @moku/editor

A shared notebook draft that synchronizes edits to marimo and binds cells to CodeMirror.

```ts
import { Effect } from "effect";
import * as CodeMirrorView from "@codemirror/view";
import * as Host from "@moku/core/Host";
import * as Document from "@moku/editor/Document";
import * as CodeMirror from "@moku/editor/CodeMirror";

const editing = Effect.gen(function* () {
  const host = yield* Host.make({ baseUrl: "http://localhost:2718/api/marimo/v1" });
  const notebook = yield* host.notebooks.attach("n1");
  return yield* Document.make(notebook);
});

function mountCell(document: Document.Interface, cellId: string, parent: HTMLElement) {
  return new CodeMirrorView.EditorView({
    parent,
    extensions: [CodeMirror.bindCell({ document, cellId })],
  });
}
```

Provide an HTTP client and atom registry as shown in [@moku/core](../@moku-core/README.md).
Share one `Document.Interface` and the notebook's registry across cell editors.
`document.edit` applies draft changes; `document.state` exposes the draft and sync status.
Edits synchronize automatically. `document.flush` waits for confirmation without saving to disk.
