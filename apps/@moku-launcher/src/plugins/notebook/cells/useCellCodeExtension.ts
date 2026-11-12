import * as React from "react";
import * as CodeMirrorPython from "@codemirror/lang-python";
import * as CodeMirrorMarkdown from "@codemirror/lang-markdown";
import * as CodeMirrorSQL from "@codemirror/lang-sql";
import * as CodeMirror from "@moku/editor/CodeMirror";
import { useDocument } from "../DocumentContext.ts";
import * as Source from "./source.ts";

const languages = {
  python: CodeMirrorPython.python(),
  markdown: CodeMirrorMarkdown.markdown(),
  sql: CodeMirrorSQL.sql(),
};

/** Binds a cell's draft through its Python, Markdown, or SQL source projection. */
export function useCellCodeExtension(cellId: string) {
  const document = useDocument();
  return React.useMemo(
    () =>
      CodeMirror.bindCell({
        document,
        cellId,
        source: (code) => {
          const source = Source.read(code);
          return {
            code: source.code,
            write: (text) => Source.write(source, text),
            extension: languages[source.language],
          };
        },
      }),
    [document, cellId],
  );
}
