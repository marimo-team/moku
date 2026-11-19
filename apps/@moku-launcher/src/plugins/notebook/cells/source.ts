import * as SmartCells from "@marimo-team/smart-cells";

export type Language = "python" | "markdown" | "sql";
export type Source =
  | { readonly language: "python"; readonly code: string }
  | {
      readonly language: "markdown";
      readonly code: string;
      readonly metadata: SmartCells.MarkdownMetadata;
    }
  | {
      readonly language: "sql";
      readonly code: string;
      readonly metadata: SmartCells.SQLMetadata;
    };

const markdown = new SmartCells.MarkdownParser();
const sql = new SmartCells.SQLParser();

/** Infer a smart cell initially; preserve its language on subsequent pulls. */
export function read(code: string, language?: Language): Source {
  if (language !== "python" && code.trim()) {
    if (
      (language === undefined || language === "markdown") &&
      markdown.isSupported(code)
    ) {
      return { ...markdown.transformIn(code), language: "markdown" };
    }
    if ((language === undefined || language === "sql") && sql.isSupported(code)) {
      return { ...sql.transformIn(code), language: "sql" };
    }
  }
  return { code, language: "python" };
}

/** The document always stores Python, even when the editor shows Markdown/SQL. */
export function write(source: Source, code: string): string {
  switch (source.language) {
    case "markdown":
      return markdown.transformOut(code, source.metadata).code;
    case "sql":
      return sql.transformOut(code, source.metadata).code;
    case "python":
      return code;
  }
}

/**
 * Writes the Python source for a new cell whose editor shows `text` in `language`.
 *
 * Markdown and SQL cells call marimo through `mo`, which the notebook must import.
 */
export function create(language: Language, text: string): string {
  switch (language) {
    case "markdown":
      return markdown.transformOut(text, markdown.defaultMetadata).code;
    case "sql":
      return sql.transformOut(text, sql.defaultMetadata).code;
    case "python":
      return text;
  }
}

/** Whether a cell's source imports marimo as `mo`, as Markdown and SQL cells require. */
export function importsMarimo(code: string | null): boolean {
  return code !== null && /^\s*import\s+marimo\s+as\s+mo\s*$/m.test(code);
}
