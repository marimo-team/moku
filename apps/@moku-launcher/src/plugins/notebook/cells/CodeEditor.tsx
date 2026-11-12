import * as CodeMirrorState from "@codemirror/state";
import * as CodeMirrorLanguage from "@codemirror/language";
import * as CodeMirrorCommands from "@codemirror/commands";
import type * as Protocol from "@moku/core/Protocol";
import { useCellCodeExtension } from "./useCellCodeExtension.ts";
import * as CodeMirrorView from "@codemirror/view";
import * as React from "react";
import * as LezerHighlight from "@lezer/highlight";

const extensions = [
  CodeMirrorLanguage.syntaxHighlighting(
    CodeMirrorLanguage.HighlightStyle.define([
      { tag: LezerHighlight.tags.keyword, color: "var(--syntax-keyword)" },
      { tag: LezerHighlight.tags.string, color: "var(--syntax-string)" },
      {
        tag: [
          LezerHighlight.tags.number,
          LezerHighlight.tags.bool,
          LezerHighlight.tags.null,
        ],
        color: "var(--syntax-literal)",
      },
      { tag: LezerHighlight.tags.comment, color: "var(--color-faint)" },
      {
        tag: LezerHighlight.tags.function(LezerHighlight.tags.variableName),
        color: "var(--syntax-function)",
      },
      {
        tag: [LezerHighlight.tags.typeName, LezerHighlight.tags.className],
        color: "var(--syntax-type)",
      },
      {
        tag: [
          LezerHighlight.tags.operator,
          LezerHighlight.tags.special(LezerHighlight.tags.variableName),
        ],
        color: "var(--syntax-operator)",
      },
      { tag: LezerHighlight.tags.invalid, color: "var(--color-error)" },
    ]),
  ),
  CodeMirrorView.highlightSpecialChars(),
  CodeMirrorView.lineNumbers(),
  CodeMirrorView.placeholder("Empty cell"),
  CodeMirrorCommands.history(),
  CodeMirrorView.keymap.of([
    ...CodeMirrorCommands.defaultKeymap,
    ...CodeMirrorCommands.historyKeymap,
    CodeMirrorCommands.indentWithTab,
  ]),
  CodeMirrorView.EditorView.theme({
    "&": {
      fontSize: "var(--text-control)",
      color: "var(--color-ink)",
      backgroundColor: "var(--color-editor)",
    },
    ".cm-scroller": {
      fontFamily: "var(--font-mono)",
      lineHeight: "var(--leading-code)",
      overflow: "auto",
    },
    ".cm-line": { padding: "0 var(--space-4) 0 var(--space-2)" },
    ".cm-gutters": {
      backgroundColor: "var(--color-editor)",
      color: "var(--color-faint)",
      border: "none",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      width: "var(--line-gutter)",
      padding: "0 var(--space-2) 0 var(--space-3)",
    },
    ".cm-placeholder": { color: "var(--color-muted)" },
    ".cm-content": {
      padding: "var(--space-3) 0",
      caretColor: "var(--color-ink)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
    ".cm-content ::selection": { backgroundColor: "var(--color-selection)" },
    ".cm-content:focus-visible": { outlineOffset: "-2px" },
  }),
];

export function CodeEditor({
  cellId,
  autoFocus = false,
  onRun,
  focusRequest,
}: {
  cellId: Protocol.CellId;
  autoFocus?: boolean;
  onRun?: (advance: boolean) => void;
  focusRequest?: number;
}) {
  const binding = useCellCodeExtension(cellId);
  const container = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<CodeMirrorView.EditorView | null>(null);
  const run = React.useEffectEvent((advance: boolean) => onRun?.(advance));

  React.useLayoutEffect(() => {
    if (!container.current) return;
    const view = new CodeMirrorView.EditorView({
      parent: container.current,
      extensions: [
        ...extensions,
        binding,
        cellRunKeymap((advance) => run(advance)),
        CodeMirrorView.EditorView.contentAttributes.of({
          tabindex: "0",
          "aria-label": "Cell source",
        }),
      ],
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, [binding]);

  React.useLayoutEffect(() => {
    if (autoFocus) editor.current?.focus();
  }, [autoFocus, binding]);

  React.useLayoutEffect(() => {
    if (focusRequest !== undefined) editor.current?.focus();
  }, [focusRequest]);

  return (
    <div ref={container} className="code-editor" data-runnable={onRun !== undefined} />
  );
}

/** Cmd/Ctrl+Enter stays in place; Shift+Enter advances after submission. */
function cellRunKeymap(run: (advance: boolean) => void) {
  return CodeMirrorState.Prec.highest(
    CodeMirrorView.keymap.of(
      ["Mod-Enter", "Ctrl-Enter", "Shift-Enter"].map((key) => ({
        key,
        preventDefault: true,
        run: () => {
          run(key === "Shift-Enter");
          return true;
        },
      })),
    ),
  );
}
