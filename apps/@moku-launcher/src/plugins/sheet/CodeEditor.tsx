import * as React from "react";
import * as CodeMirrorCommands from "@codemirror/commands";
import * as CodeMirrorLanguage from "@codemirror/language";
import * as CodeMirrorPython from "@codemirror/lang-python";
import * as CodeMirrorState from "@codemirror/state";
import * as CodeMirrorView from "@codemirror/view";
import { CodeMirror, type Document } from "@moku/editor";

/**
 * A compact Python editor for the formula bar, bound to one cell of the draft.
 *
 * It grows with its content up to a few lines. Mod-Enter runs the cell and
 * Escape returns to the grid.
 */
export function CodeEditor({
  document,
  cellId,
  onRun,
  onExit,
}: {
  document: Document.Interface;
  cellId: string;
  onRun: () => void;
  onExit: () => void;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  // The editor is created once per cell, so it reads the latest handlers here.
  const handlers = React.useRef({ onRun, onExit });
  handlers.current = { onRun, onExit };
  React.useLayoutEffect(() => {
    if (!container.current) return;
    const view = new CodeMirrorView.EditorView({
      parent: container.current,
      extensions: [
        CodeMirror.bindCell({ document, cellId }),
        CodeMirrorState.Prec.highest(
          CodeMirrorView.keymap.of([
            { key: "Mod-Enter", run: () => (handlers.current.onRun(), true) },
            { key: "Escape", run: () => (handlers.current.onExit(), true) },
          ]),
        ),
        CodeMirrorPython.python(),
        CodeMirrorLanguage.syntaxHighlighting(CodeMirrorLanguage.defaultHighlightStyle),
        CodeMirrorCommands.history(),
        CodeMirrorView.keymap.of([
          ...CodeMirrorCommands.defaultKeymap,
          ...CodeMirrorCommands.historyKeymap,
          CodeMirrorCommands.indentWithTab,
        ]),
        theme,
        CodeMirrorView.EditorView.contentAttributes.of({
          "aria-label": "Python source",
        }),
      ],
    });
    return () => view.destroy();
  }, [document, cellId]);
  return <div className="sheet-code" ref={container} />;
}

const theme = CodeMirrorView.EditorView.theme({
  "&": { background: "transparent", color: "inherit" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    maxHeight: "176px",
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "13px",
    lineHeight: "20px",
  },
  ".cm-content": { padding: "5px 0", caretColor: "currentColor" },
  ".cm-line": { padding: "0 10px" },
});
