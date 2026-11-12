import { useLayoutEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { python } from "@codemirror/lang-python";
import { CodeMirror, type Document } from "@moku/editor";

/** A plain CodeMirror editor bound to one cell in the shared notebook draft. */
export function CellEditor({
  document,
  cellId,
}: {
  document: Document.Interface;
  cellId: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!container.current) return;
    const view = new EditorView({
      parent: container.current,
      extensions: [
        // The binding handles draft updates, external edits, and read-only permissions.
        CodeMirror.bindCell({ document, cellId }),
        // CodeMirror’s standard Python highlighting, gutter, and editing shortcuts.
        lineNumbers(),
        python(),
        syntaxHighlighting(defaultHighlightStyle),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        theme,
        EditorView.contentAttributes.of({ "aria-label": "Cell source" }),
      ],
    });
    // Switching cells destroys the old editor and its subscriptions.
    return () => view.destroy();
  }, [document, cellId]);
  return <div ref={container} />;
}

const theme = EditorView.theme({
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
