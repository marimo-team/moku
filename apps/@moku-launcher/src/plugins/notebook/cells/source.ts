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

export function sameMetadata(a: Source, b: Source): boolean {
  if (a.language !== b.language) return false;
  if (a.language === "python" || b.language === "python") return true;
  return JSON.stringify(a.metadata) === JSON.stringify(b.metadata);
}
