/**
 * Projects neo4j driver calls in Python cells into editable Cypher.
 *
 * A Cypher cell is stored as one assignment from `driver.execute_query`, so the
 * notebook stays plain Python that stock marimo can run:
 *
 * ```python
 * movies = driver.execute_query(
 *     """
 *     MATCH (p:Person)-[r:ACTED_IN]->(m:Movie)
 *     RETURN p, r, m
 *     """,
 *     database_="neo4j",
 * )
 * ```
 *
 * Like marimo's SQL cells, a query can interpolate Python with `{expression}`,
 * such as `LIMIT {limit.value}`, and is then stored as an f-string. Braces that
 * open a Cypher map, such as `{name: "Keanu"}`, stay literal; see
 * {@link interpolations} for the exact rule.
 *
 * @module
 */
import type * as LezerCommon from "@lezer/common";
import * as LezerPython from "@lezer/python";

/** Python surrounding the Cypher text that a round trip must preserve. */
export interface Metadata {
  /** The public variable bound to the driver's result. */
  readonly variable: string;
  /** The variable holding the neo4j driver. */
  readonly driver: string;
  /** Source text of each argument after the query, such as `database_="neo4j"`. */
  readonly args: readonly string[];
  /** Comment lines written above the assignment. */
  readonly comments: readonly string[];
}

/** Cypher text projected from a cell, with the Python needed to write it back. */
export interface Cell {
  readonly cypher: string;
  readonly metadata: Metadata;
}

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const indent = "    ";

/** A Python expression in Cypher text, evaluated before the query is sent. */
export interface Interpolation {
  /** Offset of the opening brace. */
  readonly from: number;
  /** Offset just past the closing brace. */
  readonly to: number;
  /** The Python source between the braces. */
  readonly expression: string;
}

/**
 * Reads a cell's Python as a Cypher query.
 *
 * Returns undefined unless the code is optional comment lines followed by
 * exactly one `NAME = DRIVER.execute_query("...", ...)` assignment whose query
 * is a single string literal. An f-string's replacement fields appear as
 * `{expression}` and its doubled braces as single ones.
 */
export function read(python: string): Cell | undefined {
  const code = python.trim();
  const tree = LezerPython.parser.parse(code);
  let invalid = false;
  tree.iterate({
    enter: (node) => {
      if (node.type.isError) invalid = true;
    },
  });
  if (invalid) return undefined;

  const script = tree.topNode;
  const comments: string[] = [];
  let assignment: LezerCommon.SyntaxNode | undefined;
  for (let child = script.firstChild; child; child = child.nextSibling) {
    if (child.name === "Comment" && !assignment) comments.push(text(code, child));
    else if (child.name === "AssignStatement" && !assignment) assignment = child;
    else return undefined;
  }
  if (!assignment) return undefined;

  const [target, op, call, ...rest] = children(assignment);
  if (
    rest.length > 0 ||
    target?.name !== "VariableName" ||
    op?.name !== "AssignOp" ||
    call?.name !== "CallExpression"
  )
    return undefined;

  const [member, argList] = children(call);
  if (member?.name !== "MemberExpression" || argList?.name !== "ArgList")
    return undefined;
  const [driver, dot, property, ...extra] = children(member);
  if (
    extra.length > 0 ||
    driver?.name !== "VariableName" ||
    dot?.name !== "." ||
    property?.name !== "PropertyName" ||
    text(code, property) !== "execute_query"
  )
    return undefined;

  const groups = splitArguments(argList);
  if (!groups) return undefined;
  const [query, ...args] = groups;
  if (
    query?.length !== 1 ||
    (query[0]?.name !== "String" && query[0]?.name !== "FormatString")
  )
    return undefined;
  const cypher = decodeString(text(code, query[0]));
  if (cypher === undefined) return undefined;

  return {
    cypher: margin(cypher),
    metadata: {
      variable: text(code, target),
      driver: text(code, driver),
      args: args.map((group) => code.slice(group[0]!.from, group.at(-1)!.to)),
      comments,
    },
  };
}

/** Whether a cell's Python is shown as Cypher by {@link read}. */
export function isCypher(python: string): boolean {
  return read(python) !== undefined;
}

/**
 * Writes Cypher back as the Python driver call described by its metadata.
 *
 * {@link read} returns exactly the same text, including surrounding blank lines
 * and indentation, so an editor can re-project the cell after every keystroke.
 * A query with {@link interpolations} becomes an f-string whose other braces
 * are doubled; any other query stays a plain string. Backslashes and triple
 * quotes are escaped outside of interpolations.
 */
export function write(cypher: string, metadata: Metadata): string {
  const fields = interpolations(cypher);
  const escape = (literal: string) => {
    const escaped = literal.replaceAll("\\", "\\\\").replaceAll('"""', '\\"\\"\\"');
    return fields.length > 0
      ? escaped.replaceAll("{", "{{").replaceAll("}", "}}")
      : escaped;
  };
  let source = "";
  let position = 0;
  for (const field of fields) {
    source += escape(cypher.slice(position, field.from));
    source += cypher.slice(field.from, field.to);
    position = field.to;
  }
  source += escape(cypher.slice(position));
  const prefix = fields.length > 0 ? "f" : "";
  const body = source
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : ""))
    .join("\n");
  const args = metadata.args.map((arg) => `${indent}${arg},\n`).join("");
  return [
    ...metadata.comments,
    `${metadata.variable} = ${metadata.driver}.execute_query(\n` +
      `${indent}${prefix}"""\n${body}\n${indent}""",\n${args})`,
  ].join("\n");
}

/** Creates the Python for a new Cypher cell that binds `variable`. */
export function create(
  variable: string,
  { driver = "driver", cypher = "" }: { driver?: string; cypher?: string } = {},
): string {
  return write(cypher, { variable, driver, args: [], comments: [] });
}

/**
 * Picks the first name in `graph`, `graph_2`, `graph_3`, … that is not taken.
 *
 * Pass every name the notebook already defines.
 */
export function nextVariable(taken: Iterable<string>): string {
  const names = new Set(taken);
  if (!names.has("graph")) return "graph";
  let index = 2;
  while (names.has(`graph_${index}`)) index++;
  return `graph_${index}`;
}

/**
 * Finds the `{expression}` fields that Python evaluates in Cypher text.
 *
 * A brace starts a Cypher map, and stays literal, when it is followed by `}`,
 * `.`, or a `key:` pair, as in `{}`, `{.name}`, or `{name: $actor}`. Otherwise
 * it starts an interpolation when its matching brace encloses a non-empty
 * Python expression that does not begin with `{`. Every other brace is
 * literal, so unfinished text stays valid while it is typed.
 */
export function interpolations(cypher: string): Interpolation[] {
  const fields: Interpolation[] = [];
  for (let index = 0; index < cypher.length; index++) {
    if (cypher[index] !== "{" || mapStart.test(cypher.slice(index + 1))) continue;
    const end = closingBrace(cypher, index);
    if (end === undefined) continue;
    const expression = cypher.slice(index + 1, end);
    if (!expression.trim() || expression.trimStart().startsWith("{")) continue;
    if (!isExpression(expression)) continue;
    fields.push({ from: index, to: end + 1, expression });
    index = end;
  }
  return fields;
}

const mapStart = /^\s*(?:\}|\.|[A-Za-z_][A-Za-z0-9_]*\s*:(?!:)|`[^`]*`\s*:)/;

/** Finds the brace closing the one at `open`, skipping nested brackets and strings. */
function closingBrace(text: string, open: number): number | undefined {
  const closers: string[] = [];
  for (let index = open; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"' || char === "'") {
      const close = text.indexOf(char, index + 1);
      if (close < 0) return undefined;
      index = close;
    } else if (char === "{") closers.push("}");
    else if (char === "(") closers.push(")");
    else if (char === "[") closers.push("]");
    else if (char === "}" || char === ")" || char === "]") {
      if (closers.pop() !== char) return undefined;
      if (closers.length === 0) return char === "}" ? index : undefined;
    }
  }
  return undefined;
}

function isExpression(source: string): boolean {
  const tree = LezerPython.parser.parse(`(${source})`);
  let valid = tree.topNode.firstChild?.name === "ExpressionStatement";
  tree.iterate({
    enter: (node) => {
      if (node.type.isError) valid = false;
    },
  });
  return valid && tree.topNode.firstChild?.nextSibling === null;
}

/** Whether `name` can be bound by a Cypher cell and read back by the client. */
export function isPublicVariable(name: string): boolean {
  return identifier.test(name) && !name.startsWith("_");
}

function text(code: string, node: LezerCommon.SyntaxNode): string {
  return code.slice(node.from, node.to);
}

function children(node: LezerCommon.SyntaxNode): LezerCommon.SyntaxNode[] {
  const nodes: LezerCommon.SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) nodes.push(child);
  return nodes;
}

/** Groups argument nodes between commas, rejecting comments and empty arguments. */
function splitArguments(
  argList: LezerCommon.SyntaxNode,
): LezerCommon.SyntaxNode[][] | undefined {
  const nodes = children(argList);
  if (nodes[0]?.name !== "(" || nodes.at(-1)?.name !== ")") return undefined;
  const groups: LezerCommon.SyntaxNode[][] = [[]];
  for (const node of nodes.slice(1, -1)) {
    if (node.name === "Comment") return undefined;
    if (node.name === ",") groups.push([]);
    else groups.at(-1)!.push(node);
  }
  // A trailing comma leaves one empty group at the end.
  if (groups.length > 1 && groups.at(-1)!.length === 0) groups.pop();
  return groups.every((group) => group.length > 0) ? groups : undefined;
}

/** Decodes a plain, raw, or f-string literal; bytes are rejected. */
function decodeString(literal: string): string | undefined {
  const prefix = /^[A-Za-z]*/.exec(literal)![0];
  const format = /^(?:[fF][rR]?|[rR][fF])$/.test(prefix);
  if (!format && !/^[rRuU]?$/.test(prefix)) return undefined;
  const quoted = literal.slice(prefix.length);
  const quote = ['"""', "'''", '"', "'"].find(
    (quote) => quoted.startsWith(quote) && quoted.endsWith(quote),
  );
  if (!quote || quoted.length < quote.length * 2) return undefined;
  const content = quoted.slice(quote.length, -quote.length);
  const raw = /[rR]/.test(prefix);
  if (!format) return raw ? content : unescape(content);

  // Keep replacement fields as written and decode only the literal text around them.
  let decoded = "";
  let pending = "";
  const flush = () => {
    decoded += raw ? pending : unescape(pending);
    pending = "";
  };
  for (let index = 0; index < content.length; index++) {
    const char = content[index]!;
    const next = content[index + 1];
    if ((char === "{" && next === "{") || (char === "}" && next === "}")) {
      pending += char;
      index++;
    } else if (char === "{") {
      const end = closingBrace(content, index);
      if (end === undefined) return undefined;
      flush();
      decoded += content.slice(index, end + 1);
      index = end;
    } else pending += char;
  }
  flush();
  return decoded;
}

const escapes: Record<string, string> = {
  "\\": "\\",
  "'": "'",
  '"': '"',
  a: "\x07",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\n": "",
};

function unescape(content: string): string {
  return content.replace(
    /\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|[\s\S])/g,
    (match, escape: string) => {
      if (escape in escapes) return escapes[escape]!;
      if (/^[xuU]/.test(escape))
        return String.fromCodePoint(Number.parseInt(escape.slice(1), 16));
      if (/^[0-7]/.test(escape))
        return String.fromCodePoint(Number.parseInt(escape, 8));
      // Python keeps unrecognized escapes, including the backslash.
      return match;
    },
  );
}

/**
 * Removes the line breaks after the opening quotes and before the closing quotes.
 *
 * When the closing quotes sit on their own line, their indentation is the
 * margin removed from every line, as {@link write} lays them out. Otherwise the
 * indentation shared by all non-blank lines is removed.
 */
function margin(content: string): string {
  const lines = content.split("\n");
  if (lines.length === 1) return content;
  if (!lines[0]!.trim()) lines.shift();
  const last = lines.at(-1)!;
  let width: number;
  if (!last.trim()) {
    lines.pop();
    width = last.length;
  } else {
    width = Math.min(
      ...lines.filter((line) => line.trim()).map((line) => leading(line)),
    );
  }
  return lines.map((line) => line.slice(Math.min(width, leading(line)))).join("\n");
}

function leading(line: string): number {
  return /^[ \t]*/.exec(line)![0].length;
}
