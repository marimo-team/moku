// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { history, undo, undoDepth } from "@codemirror/commands";
import * as CodeMirror from "../src/CodeMirror.ts";
import { setup, cell, confirmed } from "./fixture.ts";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
  }
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function editor(binding: Extension, extensions: Extension = []) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ extensions: [history(), binding, extensions] }),
  });
  views.push(view);
  return view;
}

function replace(view: EditorView, text: string, filter = true) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    filter,
  });
}

test("initial source stays out of history; typing and undo update the document", async () => {
  const h = await setup();
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  await tick();

  expect(view.state.doc.toString()).toBe(cell.code);
  expect(undoDepth(view.state)).toBe(0);
  replace(view, "typed");
  expect(h.code()).toBe("typed");
  expect(undo(view)).toBe(true);
  expect(h.code()).toBe(cell.code);
});

test("remote edits map selection across separate changes without creating undo entries", async () => {
  const h = await setup();
  h.publish("aaa\nmiddle\nzzz", 2);
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  await tick();
  view.dispatch({ selection: { anchor: 7 } });

  h.publish("aaaaa\nmiddle\nzzzzz", 3);
  await tick();
  expect(view.state.doc.toString()).toBe("aaaaa\nmiddle\nzzzzz");
  expect(view.state.selection.main.anchor).toBe(9);
  expect(undoDepth(view.state)).toBe(0);
  expect(h.registry.get(h.model.dirty)).toBe(false);
});

test("a binding can be reused by views that share a draft and have independent lifetimes", async () => {
  const h = await setup();
  const binding = CodeMirror.bindCell({ document: h.model, cellId: cell.id });
  const first = editor(binding);
  const second = editor(binding);
  await tick();

  replace(first, "shared draft");
  await tick();
  expect(second.state.doc.toString()).toBe("shared draft");
  first.destroy();
  views.splice(views.indexOf(first), 1);

  const remounted = editor(binding);
  await tick();
  expect(remounted.state.doc.toString()).toBe("shared draft");
  replace(second, "still editable");
  expect(h.code()).toBe("still editable");
});

test("caller extensions remain active and raw source is preserved", async () => {
  const h = await setup();
  const raw = 'mo.md("# Heading")';
  h.publish(raw, 2);
  let invoked = false;
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }), [
    EditorState.tabSize.of(8),
    keymap.of([
      {
        key: "F2",
        run: () => {
          invoked = true;
          return true;
        },
      },
    ]),
    EditorView.theme({ "&": { color: "rgb(12, 34, 56)" } }),
  ]);
  await tick();

  expect(view.state.doc.toString()).toBe(raw);
  expect(view.state.tabSize).toBe(8);
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "F2",
      code: "F2",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(invoked).toBe(true);
  replace(view, 'mo.md("updated")');
  expect(h.code()).toBe('mo.md("updated")');
});

test("permission changes block writes immediately, including unfiltered transactions", async () => {
  const h = await setup();
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  await tick();
  h.registry.update(h.source, (source) => ({ ...source, canEdit: false }));
  replace(view, "forbidden");
  expect(h.code()).toBe(cell.code);
  replace(view, "also forbidden", false);
  expect(h.code()).toBe(cell.code);
  await tick();

  expect(view.state.readOnly).toBe(true);
  expect(view.contentDOM.getAttribute("aria-readonly")).toBe("true");
  expect(view.state.doc.toString()).toBe(cell.code);
  h.registry.update(h.source, (source) => ({ ...source, canEdit: true }));
  await tick();
  expect(view.state.readOnly).toBe(false);
  replace(view, "allowed");
  expect(h.code()).toBe("allowed");
});

test("missing or withheld source clears the view until source is available again", async () => {
  const h = await setup();
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  await tick();
  h.registry.set(h.source, {
    canEdit: true,
    document: { ...confirmed(), cells: new Map([[cell.id, { ...cell, code: null }]]) },
  });
  await tick();
  expect(view.state.doc.toString()).toBe("");
  expect(view.state.readOnly).toBe(true);
  h.publish("available", 2);
  await tick();
  expect(view.state.doc.toString()).toBe("available");

  h.registry.set(h.model.edit, (tx) => tx.deleteCell(cell.id));
  await tick();
  expect(view.state.doc.toString()).toBe("");
  expect(view.state.readOnly).toBe(true);
});

test("a stream reset hides source and restores the local draft with the next snapshot", async () => {
  const h = await setup();
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  await tick();
  replace(view, "local draft");
  h.registry.set(h.source, { document: null, canEdit: false });
  await tick();
  expect(view.state.doc.toString()).toBe("");
  expect(view.state.readOnly).toBe(true);
  h.publish("remote", 2);
  await tick();
  expect(view.state.doc.toString()).toBe("local draft");
});

test("pending source changes cannot be overwritten by edits against stale view text", async () => {
  const h = await setup();
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  await tick();
  h.publish("new remote source", 2);
  replace(view, "stale edit");
  expect(h.code()).toBe("new remote source");
  await tick();
  expect(view.state.doc.toString()).toBe("new remote source");
  expect(h.registry.get(h.model.dirty)).toBe(false);
});

test("source pulls wait for composition, including an end without a text change", async () => {
  const h = await setup();
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  await tick();
  let composing = true;
  Object.defineProperty(view, "composing", { get: () => composing });
  h.publish("remote", 2);
  await tick();
  expect(view.state.doc.toString()).toBe(cell.code);

  composing = false;
  view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
  await tick();
  await tick();
  expect(view.state.doc.toString()).toBe("remote");
});

test("destroying a view cancels queued pulls and leaves the document usable", async () => {
  const h = await setup();
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  const dispatch = vi.spyOn(view, "dispatch");
  view.destroy();
  views.splice(views.indexOf(view), 1);
  h.change("retained");
  await tick();
  expect(dispatch).not.toHaveBeenCalled();
  expect(h.code()).toBe("retained");
  expect(h.registry.get(h.model.canEdit)).toBe(true);
});

test("closing the document makes remaining views read-only and prevents further drafts", async () => {
  const h = await setup();
  const view = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  await tick();
  await h.close();
  await tick();
  expect(h.registry.get(h.model.canEdit)).toBe(false);
  expect(view.state.readOnly).toBe(true);
  replace(view, "too late");
  expect(h.code()).toBe(cell.code);
  const another = editor(CodeMirror.bindCell({ document: h.model, cellId: cell.id }));
  await tick();
  expect(another.state.readOnly).toBe(true);
});
