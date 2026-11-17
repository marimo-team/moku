import * as React from "react";
import * as CodeMirrorCommands from "@codemirror/commands";
import * as CodeMirrorLanguage from "@codemirror/language";
import * as CodeMirrorLegacyCypher from "@codemirror/legacy-modes/mode/cypher";
import * as CodeMirrorState from "@codemirror/state";
import * as CodeMirrorView from "@codemirror/view";
import * as LezerHighlight from "@lezer/highlight";
import * as CodeMirror from "@moku/editor/CodeMirror";
import { useDocument } from "../notebook/DocumentContext.ts";
import * as Cypher from "./cypher.ts";

// The binding swaps projection extensions by identity, so keep this one stable.
const language = CodeMirrorLanguage.StreamLanguage.define(
  CodeMirrorLegacyCypher.cypher,
);

/** Marks `{expression}` fields so it is clear which braces Python evaluates. */
const interpolationMark = CodeMirrorView.Decoration.mark({
  class: "cm-cypher-interpolation",
});
const interpolationHighlight = CodeMirrorView.ViewPlugin.fromClass(
  class {
    decorations: CodeMirrorView.DecorationSet;
    constructor(view: CodeMirrorView.EditorView) {
      this.decorations = mark(view);
    }
    update(update: CodeMirrorView.ViewUpdate) {
      if (update.docChanged) this.decorations = mark(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

function mark(view: CodeMirrorView.EditorView): CodeMirrorView.DecorationSet {
  return CodeMirrorView.Decoration.set(
    Cypher.interpolations(view.state.doc.toString()).map((field) =>
      interpolationMark.range(field.from, field.to),
    ),
  );
}

const extensions = [
  interpolationHighlight,
  CodeMirrorLanguage.syntaxHighlighting(
    CodeMirrorLanguage.HighlightStyle.define([
      { tag: LezerHighlight.tags.keyword, color: "var(--syntax-keyword)" },
      { tag: LezerHighlight.tags.string, color: "var(--syntax-string)" },
      {
        tag: [LezerHighlight.tags.number, LezerHighlight.tags.atom],
        color: "var(--syntax-literal)",
      },
      { tag: LezerHighlight.tags.comment, color: "var(--color-faint)" },
      {
        tag: [LezerHighlight.tags.standard(LezerHighlight.tags.variableName)],
        color: "var(--syntax-function)",
      },
      {
        tag: [
          LezerHighlight.tags.definition(LezerHighlight.tags.variableName),
          LezerHighlight.tags.typeName,
        ],
        color: "var(--syntax-type)",
      },
      { tag: LezerHighlight.tags.operator, color: "var(--syntax-operator)" },
    ]),
  ),
  CodeMirrorView.highlightSpecialChars(),
  CodeMirrorView.lineNumbers(),
  CodeMirrorView.placeholder("MATCH (n) RETURN n LIMIT 25"),
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
    ".cm-content": { padding: "var(--space-3) 0", caretColor: "var(--color-ink)" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
    ".cm-content ::selection": { backgroundColor: "var(--color-selection)" },
    ".cm-content:focus-visible": { outlineOffset: "-2px" },
    ".cm-cypher-interpolation, .cm-cypher-interpolation *": {
      color: "var(--graph-accent)",
    },
    ".cm-cypher-interpolation": {
      borderRadius: "3px",
      backgroundColor: "var(--graph-accent-soft)",
    },
  }),
];

/** Binds a cell's driver call to an editor that shows only its Cypher. */
export function CypherEditor({
  cellId,
  autoFocus = false,
  onRun,
  focusRequest,
}: {
  cellId: string;
  autoFocus?: boolean;
  onRun?: (advance: boolean) => void;
  focusRequest?: number;
}) {
  const document = useDocument();
  const container = React.useRef<HTMLDivElement>(null);
  const editor = React.useRef<CodeMirrorView.EditorView | null>(null);
  const run = React.useEffectEvent((advance: boolean) => onRun?.(advance));
  const binding = React.useMemo(
    () =>
      CodeMirror.bindCell({
        document,
        cellId,
        source: (code) => {
          const cell = Cypher.read(code);
          // Another client may rewrite the cell as Python before this view updates.
          if (!cell) return { code, write: (text) => text };
          return {
            code: cell.cypher,
            write: (text) => Cypher.write(text, cell.metadata),
            extension: language,
          };
        },
      }),
    [document, cellId],
  );

  React.useLayoutEffect(() => {
    if (!container.current) return;
    const view = new CodeMirrorView.EditorView({
      parent: container.current,
      extensions: [
        ...extensions,
        binding,
        CodeMirrorState.Prec.highest(
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
        ),
        CodeMirrorView.EditorView.contentAttributes.of({
          tabindex: "0",
          "aria-label": "Cypher query",
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
