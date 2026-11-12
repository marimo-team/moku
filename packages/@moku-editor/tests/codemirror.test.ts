// @vitest-environment happy-dom
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import * as CodeMirrorState from "@codemirror/state";
import * as CodeMirrorView from "@codemirror/view";
import * as CodeMirrorCommands from "@codemirror/commands";
import * as CodeMirror from "../src/CodeMirror.ts";
import { setup, cell, confirmed } from "./fixture.ts";

const views: CodeMirrorView.EditorView[] = [];

Vitest.afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function editor(
  binding: CodeMirrorState.Extension,
  extensions: CodeMirrorState.Extension = [],
) {
  const view = new CodeMirrorView.EditorView({
    parent: document.body,
    state: CodeMirrorState.EditorState.create({
      extensions: [CodeMirrorCommands.history(), binding, extensions],
    }),
  });
  views.push(view);
  return view;
}

function replace(view: CodeMirrorView.EditorView, text: string, filter = true) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    filter,
  });
}

Vitest.test(
  "initial source stays out of history; typing and undo update the document",
  async () => {
    const h = await setup();
    const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    await tick();

    Vitest.expect(view.state.doc.toString()).toBe(cell.code);
    Vitest.expect(CodeMirrorCommands.undoDepth(view.state)).toBe(0);
    replace(view, "typed");
    Vitest.expect(h.code()).toBe("typed");
    Vitest.expect(CodeMirrorCommands.undo(view)).toBe(true);
    Vitest.expect(h.code()).toBe(cell.code);
  },
);

Vitest.test(
  "remote edits map selection across separate changes without creating undo entries",
  async () => {
    const h = await setup();
    h.publish("aaa\nmiddle\nzzz", 2);
    const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    await tick();
    view.dispatch({ selection: { anchor: 7 } });

    h.publish("aaaaa\nmiddle\nzzzzz", 3);
    await tick();
    Vitest.expect(view.state.doc.toString()).toBe("aaaaa\nmiddle\nzzzzz");
    Vitest.expect(view.state.selection.main.anchor).toBe(9);
    Vitest.expect(CodeMirrorCommands.undoDepth(view.state)).toBe(0);
    Vitest.expect(h.registry.get(h.model.state).dirty).toBe(false);
  },
);

Vitest.test(
  "a binding can be reused by views that share a draft and have independent lifetimes",
  async () => {
    const h = await setup();
    const binding = CodeMirror.bindCell({ document: h.model, cellId: cell.id });
    const first = editor(binding);
    const second = editor(binding);
    await tick();

    replace(first, "shared draft");
    await tick();
    Vitest.expect(second.state.doc.toString()).toBe("shared draft");
    first.destroy();
    views.splice(views.indexOf(first), 1);

    const remounted = editor(binding);
    await tick();
    Vitest.expect(remounted.state.doc.toString()).toBe("shared draft");
    replace(second, "still editable");
    Vitest.expect(h.code()).toBe("still editable");
  },
);

Vitest.test("caller extensions remain active and raw source is preserved", async () => {
  const h = await setup();
  const raw = 'mo.md("# Heading")';
  h.publish(raw, 2);
  let invoked = false;
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }), [
    CodeMirrorState.EditorState.tabSize.of(8),
    CodeMirrorView.keymap.of([
      {
        key: "F2",
        run: () => {
          invoked = true;
          return true;
        },
      },
    ]),
    CodeMirrorView.EditorView.theme({ "&": { color: "rgb(12, 34, 56)" } }),
  ]);
  await tick();

  Vitest.expect(view.state.doc.toString()).toBe(raw);
  Vitest.expect(view.state.tabSize).toBe(8);
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "F2",
      code: "F2",
      bubbles: true,
      cancelable: true,
    }),
  );
  Vitest.expect(invoked).toBe(true);
  replace(view, 'mo.md("updated")');
  Vitest.expect(h.code()).toBe('mo.md("updated")');
});

Vitest.test(
  "permission changes block writes immediately, including unfiltered transactions",
  async () => {
    const h = await setup();
    const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    await tick();
    h.registry.update(h.source, (source) => ({ ...source, canEdit: false }));
    replace(view, "forbidden");
    Vitest.expect(h.code()).toBe(cell.code);
    replace(view, "also forbidden", false);
    Vitest.expect(h.code()).toBe(cell.code);
    await tick();

    Vitest.expect(view.state.readOnly).toBe(true);
    Vitest.expect(view.contentDOM.getAttribute("aria-readonly")).toBe("true");
    Vitest.expect(view.state.doc.toString()).toBe(cell.code);
    h.registry.update(h.source, (source) => ({ ...source, canEdit: true }));
    await tick();
    Vitest.expect(view.state.readOnly).toBe(false);
    replace(view, "allowed");
    Vitest.expect(h.code()).toBe("allowed");
  },
);

Vitest.test(
  "missing or withheld source clears the view until source is available again",
  async () => {
    const h = await setup();
    const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    await tick();
    h.registry.set(h.source, {
      canEdit: true,
      document: {
        ...confirmed(),
        cells: new Map([[cell.id, { ...cell, code: null }]]),
      },
    });
    await tick();
    Vitest.expect(view.state.doc.toString()).toBe("");
    Vitest.expect(view.state.readOnly).toBe(true);
    h.publish("available", 2);
    await tick();
    Vitest.expect(view.state.doc.toString()).toBe("available");

    h.model.edit((tx) => tx.deleteCell(cell.id));
    await tick();
    Vitest.expect(view.state.doc.toString()).toBe("");
    Vitest.expect(view.state.readOnly).toBe(true);
  },
);

Vitest.test(
  "a stream reset hides source and restores the local draft with the next snapshot",
  async () => {
    const h = await setup();
    const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    await tick();
    replace(view, "local draft");
    h.registry.set(h.source, { document: null, canEdit: false });
    await tick();
    Vitest.expect(view.state.doc.toString()).toBe("");
    Vitest.expect(view.state.readOnly).toBe(true);
    h.publish("remote", 2);
    await tick();
    Vitest.expect(view.state.doc.toString()).toBe("local draft");
  },
);

Vitest.test(
  "pending source changes cannot be overwritten by edits against stale view text",
  async () => {
    const h = await setup();
    const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    await tick();
    h.publish("new remote source", 2);
    replace(view, "stale edit");
    Vitest.expect(h.code()).toBe("new remote source");
    await tick();
    Vitest.expect(view.state.doc.toString()).toBe("new remote source");
    Vitest.expect(h.registry.get(h.model.state).dirty).toBe(false);
  },
);

Vitest.test(
  "source pulls wait for composition, including an end without a text change",
  async () => {
    const h = await setup();
    const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    await tick();
    let composing = true;
    Object.defineProperty(view, "composing", { get: () => composing });
    h.publish("remote", 2);
    await tick();
    Vitest.expect(view.state.doc.toString()).toBe(cell.code);

    composing = false;
    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await tick();
    await tick();
    Vitest.expect(view.state.doc.toString()).toBe("remote");
  },
);

Vitest.test(
  "destroying a view cancels queued pulls and leaves the document usable",
  async () => {
    const h = await setup();
    const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    const dispatch = vi.spyOn(view, "dispatch");
    view.destroy();
    views.splice(views.indexOf(view), 1);
    h.change("retained");
    await tick();
    Vitest.expect(dispatch).not.toHaveBeenCalled();
    Vitest.expect(h.code()).toBe("retained");
    Vitest.expect(h.registry.get(h.model.state).canEdit).toBe(true);
  },
);

Vitest.test(
  "closing the document makes remaining views read-only and prevents further drafts",
  async () => {
    const h = await setup();
    const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    await tick();
    await h.close();
    await tick();
    Vitest.expect(h.registry.get(h.model.state).canEdit).toBe(false);
    Vitest.expect(view.state.readOnly).toBe(true);
    replace(view, "too late");
    Vitest.expect(h.code()).toBe(cell.code);
    const another = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
    await tick();
    Vitest.expect(another.state.readOnly).toBe(true);
  },
);
