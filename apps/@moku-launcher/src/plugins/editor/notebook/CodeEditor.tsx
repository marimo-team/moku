import { Prec } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
} from "@codemirror/commands";
import type * as Protocol from "@moku/core/Protocol";
import { useCellCodeExtension } from "./document.tsx";
import {
  EditorView,
  keymap,
  highlightSpecialChars,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { useLayoutEffect, useRef } from "react";
import { tags } from "@lezer/highlight";

const extensions = [
  syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.keyword, color: "var(--syntax-keyword)" },
      { tag: tags.string, color: "var(--syntax-string)" },
      {
        tag: [tags.number, tags.bool, tags.null],
        color: "var(--syntax-literal)",
      },
      { tag: tags.comment, color: "var(--color-faint)" },
      {
        tag: tags.function(tags.variableName),
        color: "var(--syntax-function)",
      },
      { tag: [tags.typeName, tags.className], color: "var(--syntax-type)" },
      {
        tag: [tags.operator, tags.special(tags.variableName)],
        color: "var(--syntax-operator)",
      },
      { tag: tags.invalid, color: "var(--color-error)" },
    ]),
  ),
  highlightSpecialChars(),
  lineNumbers(),
  placeholder("Empty cell"),
  history(),
  keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
  EditorView.theme({
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
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const run = useRef(onRun);
  useLayoutEffect(() => {
    run.current = onRun;
  }, [onRun]);

  useLayoutEffect(() => {
    if (!container.current) return;
    const view = new EditorView({
      parent: container.current,
      extensions: [
        ...extensions,
        binding,
        cellRunKeymap((advance) => run.current?.(advance)),
        EditorView.contentAttributes.of({
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

  useLayoutEffect(() => {
    if (autoFocus) editor.current?.focus();
  }, [autoFocus, binding]);

  useLayoutEffect(() => {
    if (focusRequest !== undefined) editor.current?.focus();
  }, [focusRequest]);

  return (
    <div ref={container} className="code-editor" data-runnable={onRun !== undefined} />
  );
}

/** Cmd/Ctrl+Enter stays in place; Shift+Enter advances after submission. */
export function cellRunKeymap(run: (advance: boolean) => void) {
  return Prec.highest(
    keymap.of(
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
