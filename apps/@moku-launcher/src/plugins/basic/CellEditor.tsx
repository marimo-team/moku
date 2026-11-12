import * as React from "react";
import * as CodeMirrorView from "@codemirror/view";
import * as CodeMirrorCommands from "@codemirror/commands";
import * as CodeMirrorLanguage from "@codemirror/language";
import * as CodeMirrorPython from "@codemirror/lang-python";
import { CodeMirror, type Document } from "@moku/editor";

/** A plain CodeMirror editor bound to one cell in the shared notebook draft. */
export function CellEditor({
  document,
  cellId,
}: {
  document: Document.Interface;
  cellId: string;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    if (!container.current) return;
    const view = new CodeMirrorView.EditorView({
      parent: container.current,
      extensions: [
        // The binding handles draft updates, external edits, and read-only permissions.
        CodeMirror.bindCell({ document, cellId }),
        // CodeMirror’s standard Python highlighting, gutter, and editing shortcuts.
        CodeMirrorView.lineNumbers(),
        CodeMirrorPython.python(),
        CodeMirrorLanguage.syntaxHighlighting(CodeMirrorLanguage.defaultHighlightStyle),
        CodeMirrorCommands.history(),
        CodeMirrorView.keymap.of([
          ...CodeMirrorCommands.defaultKeymap,
          ...CodeMirrorCommands.historyKeymap,
          CodeMirrorCommands.indentWithTab,
        ]),
        theme,
        CodeMirrorView.EditorView.contentAttributes.of({ "aria-label": "Cell source" }),
      ],
    });
    // Switching cells destroys the old editor and its subscriptions.
    return () => view.destroy();
  }, [document, cellId]);
  return <div ref={container} />;
}

const theme = CodeMirrorView.EditorView.theme({
  "&": { border: "1px solid #e0e0e0", borderRadius: "6px", overflow: "hidden" },
  "&.cm-focused": { outline: "1px solid #b8b8c8" },
  ".cm-scroller": {
    overflow: "auto",
    maxHeight: "480px",
    fontSize: "13px",
    lineHeight: "1.6",
  },
  ".cm-content": { padding: "12px 0" },
  ".cm-gutters": { background: "transparent", border: "none", color: "#aaa" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px" },
});
