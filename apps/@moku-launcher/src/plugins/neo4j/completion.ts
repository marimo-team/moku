/**
 * Completes Cypher from a database's schema: labels, relationship types, property keys, and keywords.
 *
 * {@link complete} decides from the text before the cursor which names fit,
 * and {@link extension} offers them in a CodeMirror editor.
 *
 * @module
 */
import * as CodeMirrorAutocomplete from "@codemirror/autocomplete";
import type * as CodeMirrorState from "@codemirror/state";
import * as Cypher from "./cypher.ts";
import type * as Neo4jSchema from "./schema.ts";

/** One suggested name. */
export interface Option {
  readonly label: string;
  readonly kind: "label" | "relationship" | "property" | "keyword";
  /** The text inserted, when the name needs backticks. */
  readonly apply?: string;
}

/** Suggestions for the word ending at the cursor, which starts at `from`. */
export interface Completion {
  readonly from: number;
  readonly options: readonly Option[];
}

const keywords = [
  "MATCH",
  "OPTIONAL MATCH",
  "WHERE",
  "RETURN",
  "WITH",
  "ORDER BY",
  "LIMIT",
  "SKIP",
  "DISTINCT",
  "UNWIND",
  "CREATE",
  "MERGE",
  "SET",
  "DELETE",
  "DETACH DELETE",
  "REMOVE",
  "CALL",
  "YIELD",
  "UNION",
  "AS",
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS NULL",
  "IS NOT NULL",
  "CONTAINS",
  "STARTS WITH",
  "ENDS WITH",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "ASC",
  "DESC",
];

const simple = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Finds the names that fit at `position` in `cypher`.
 *
 * A word after `:` completes labels inside a node pattern and relationship
 * types inside a relationship pattern. A word after `.`, or a map key in a
 * pattern, completes property keys. Any other word of at least two letters
 * completes keywords. Nothing is offered inside strings, comments, or Python
 * interpolations, and shorter words need `explicit`, as when completion is
 * requested by key.
 */
export function complete(
  cypher: string,
  position: number,
  schema: Neo4jSchema.Schema | undefined,
  explicit = false,
): Completion | undefined {
  if (
    Cypher.interpolations(cypher).some(
      (field) => position > field.from && position < field.to,
    )
  )
    return undefined;
  const before = cypher.slice(0, position);
  const context = scan(before);
  if (context.quoted) return undefined;
  const match = /([:.]?)(`?)([A-Za-z0-9_]*)$/.exec(before)!;
  const [, sigil, , word] = match;
  const from = position - word!.length - match[2]!.length;
  const bracket = context.brackets.at(-1);

  if (sigil === ":" && schema) {
    // A colon inside a map separates a key from its value.
    if (bracket === "{") return undefined;
    const relationship = bracket === "[";
    return {
      from,
      options: names(
        relationship ? schema.relationshipTypes : schema.labels,
        relationship ? "relationship" : "label",
      ),
    };
  }
  if (sigil === "." && schema) {
    // A digit before the dot makes it a decimal point.
    if (/[0-9]\.[A-Za-z0-9_]*$/.test(before)) return undefined;
    return { from, options: names(schema.propertyKeys, "property") };
  }
  if (!word && !explicit) return undefined;
  if (bracket === "{" && schema && /[{,]\s*[A-Za-z0-9_]*$/.test(before))
    return { from, options: names(schema.propertyKeys, "property") };
  if (sigil || bracket === "{") return undefined;
  // Single letters are usually variables, so keywords wait for a second one.
  if (word!.length < 2 && !explicit) return undefined;
  return {
    from,
    options: keywords.map((label) => ({ label, kind: "keyword" })),
  };
}

function names(values: readonly string[], kind: Option["kind"]): Option[] {
  return values.map((label) =>
    simple.test(label)
      ? { label, kind }
      : { label, kind, apply: `\`${label.replaceAll("`", "``")}\`` },
  );
}

/** The unclosed brackets before the cursor, and whether it sits in a string or comment. */
function scan(text: string): { brackets: string[]; quoted: boolean } {
  const brackets: string[] = [];
  const closers: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === "'" || char === '"' || char === "`") {
      const end = text.indexOf(char, index + 1);
      // A backtick name is still being typed, which completion handles itself.
      if (end < 0) return { brackets, quoted: char !== "`" };
      index = end;
    } else if (char === "/" && text[index + 1] === "/") {
      const end = text.indexOf("\n", index);
      if (end < 0) return { brackets, quoted: true };
      index = end;
    } else if (char === "(" || char === "[" || char === "{") brackets.push(char);
    else if (char in closers && brackets.at(-1) === closers[char]) brackets.pop();
  }
  return { brackets, quoted: false };
}

const types: Record<Option["kind"], string> = {
  label: "type",
  relationship: "interface",
  property: "property",
  keyword: "keyword",
};
const details: Record<Option["kind"], string | undefined> = {
  label: "label",
  relationship: "relationship",
  property: "property",
  keyword: undefined,
};

/**
 * A CodeMirror extension that completes Cypher with {@link complete}.
 *
 * `schema` is read on every request, so completions follow the latest schema
 * without rebuilding the editor.
 */
export function extension(
  schema: () => Neo4jSchema.Schema | undefined,
): CodeMirrorState.Extension {
  return CodeMirrorAutocomplete.autocompletion({
    activateOnTyping: true,
    override: [
      (context) => {
        const result = complete(
          context.state.doc.toString(),
          context.pos,
          schema(),
          context.explicit,
        );
        if (!result || result.options.length === 0) return null;
        return {
          from: result.from,
          options: result.options.map((option) => ({
            label: option.label,
            apply: option.apply,
            type: types[option.kind],
            detail: details[option.kind],
          })),
          validFor: /^`?[A-Za-z0-9_]*$/,
        };
      },
    ],
  });
}
