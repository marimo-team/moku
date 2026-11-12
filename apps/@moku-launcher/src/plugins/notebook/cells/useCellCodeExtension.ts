import { useMemo } from "react";
import { python } from "@codemirror/lang-python";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import * as CodeMirror from "@moku/editor/CodeMirror";
import { useDocument } from "../DocumentContext.ts";
import * as Source from "./source.ts";

const languages = { python: python(), markdown: markdown(), sql: sql() };

/** Binds a cell's draft through its Python, Markdown, or SQL source projection. */
export function useCellCodeExtension(cellId: string) {
  const document = useDocument();
  return useMemo(
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
