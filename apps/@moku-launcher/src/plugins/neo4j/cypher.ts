/**
 * Projects neo4j driver calls in Python cells into editable Cypher.
 *
 * A Cypher cell is stored as an assignment from `driver.execute_query`,
 * followed by the `CypherGraph` widget that displays the result. The notebook
 * stays plain Python that stock marimo can run:
 *
 * ```python
 * movies = driver.execute_query(
 *     """
 *     MATCH (p:Person)-[r:ACTED_IN]->(m:Movie)
 *     RETURN p, r, m
 *     """,
 *     database_="neo4j",
 * )
 * movies_graph = mo.ui.anywidget(CypherGraph(movies, driver))
 * movies_graph
 * ```
 *
 * The widget receives the driver so that double-clicking a node can add its
 * neighbors to the drawing. `movies` stays what the query returned, while
 * `movies_graph.nodes` and `movies_graph.relationships` follow the drawing, and
 * marimo reruns the cells that read them after each expansion. Cells written
 * before this form display `CypherGraph(movies, driver)` directly; they are
 * read and written back unchanged.
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

/**
 * The name a new Cypher cell binds its result to.
 *
 * Names starting with an underscore stay local to the cell, as in marimo, so
 * several Cypher cells can use the default without clashing.
 */
export const defaultVariable = "_result";

/** The widget class, defined by the notebook's generated widget cell, that displays results. */
export const widget = "CypherGraph";

/** Python surrounding the Cypher text that a round trip must preserve. */
export interface Metadata {
  /** The variable bound to the driver's `EagerResult`. */
  readonly variable: string;
  /** The variable holding the neo4j driver. */
  readonly driver: string;
  /** Source text of each argument after the query, such as `database_="neo4j"`. */
  readonly args: readonly string[];
  /** Comment lines written above the assignment. */
  readonly comments: readonly string[];
  /**
   * Whether the widget is bound to {@link graphName} through `mo.ui.anywidget`.
   *
   * When false, the cell displays the widget without binding it, so other cells
   * cannot react to expansions.
   */
  readonly graph: boolean;
}

/** The name a Cypher cell binds its widget to, so other cells can read the drawing. */
export function graphName(variable: string): string {
  return `${variable}_graph`;
}

/** Cypher text projected from a cell, with the Python needed to write it back. */
export interface Cell {
  readonly cypher: string;
  readonly metadata: Metadata;
}

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
const keywords = new Set(
  "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(
    " ",
  ),
);
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
 * Returns undefined unless the code is optional comment lines, then exactly one
 * `NAME = DRIVER.execute_query("...", ...)` assignment whose query is a single
 * string literal, then either `NAME_graph = mo.ui.anywidget(CypherGraph(NAME, DRIVER))`
 * followed by `NAME_graph`, or just `CypherGraph(NAME, DRIVER)`. An f-string's
 * replacement fields appear as `{expression}` and its doubled braces as single ones.
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
  const display: LezerCommon.SyntaxNode[] = [];
  for (let child = script.firstChild; child; child = child.nextSibling) {
    if (child.name === "Comment" && !assignment) comments.push(text(code, child));
    else if (child.name === "AssignStatement" && !assignment) assignment = child;
    else if (child.name !== "Comment" && assignment) display.push(child);
    else return undefined;
  }
  if (!assignment || display.length === 0) return undefined;

  const [target, op, call, ...rest] = children(assignment);
  if (
    rest.length > 0 ||
    target?.name !== "VariableName" ||
    op?.name !== "AssignOp" ||
    call?.name !== "CallExpression"
  )
    return undefined;
  const variable = text(code, target);

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
  const graph = displayForm(code, display, variable, text(code, driver));
  if (graph === undefined) return undefined;

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
      variable,
      driver: text(code, driver),
      args: args.map((group) => code.slice(group[0]!.from, group.at(-1)!.to)),
      comments,
      graph,
    },
  };
}

/**
 * Reads the statements after the query as one of the two display forms.
 *
 * Returns whether the widget is bound to {@link graphName}, or undefined when
 * the statements are neither form.
 */
function displayForm(
  code: string,
  statements: readonly LezerCommon.SyntaxNode[],
  variable: string,
  driver: string,
): boolean | undefined {
  const [first, second, ...rest] = statements;
  if (rest.length > 0 || !first) return undefined;
  if (!second) {
    const [call, ...more] = first.name === "ExpressionStatement" ? children(first) : [];
    return more.length === 0 && call && isWidget(code, call, variable, driver)
      ? false
      : undefined;
  }
  const name = graphName(variable);
  if (first.name !== "AssignStatement" || second.name !== "ExpressionStatement")
    return undefined;
  const [target, op, wrap, ...extra] = children(first);
  const [shown, ...trailing] = children(second);
  if (
    extra.length > 0 ||
    trailing.length > 0 ||
    target?.name !== "VariableName" ||
    text(code, target) !== name ||
    op?.name !== "AssignOp" ||
    wrap?.name !== "CallExpression" ||
    shown?.name !== "VariableName" ||
    text(code, shown) !== name
  )
    return undefined;
  const [callee, argList, ...more] = children(wrap);
  if (
    more.length > 0 ||
    callee?.name !== "MemberExpression" ||
    text(code, callee) !== "mo.ui.anywidget" ||
    argList?.name !== "ArgList"
  )
    return undefined;
  const groups = splitArguments(argList);
  return groups?.length === 1 &&
    groups[0]!.length === 1 &&
    isWidget(code, groups[0]![0]!, variable, driver)
    ? true
    : undefined;
}

/** Whether `call` is exactly `CypherGraph(variable, driver)`. */
function isWidget(
  code: string,
  call: LezerCommon.SyntaxNode,
  variable: string,
  driver: string,
): boolean {
  if (call.name !== "CallExpression") return false;
  const [callee, argList, ...more] = children(call);
  if (
    more.length > 0 ||
    callee?.name !== "VariableName" ||
    text(code, callee) !== widget ||
    argList?.name !== "ArgList"
  )
    return false;
  const groups = splitArguments(argList);
  const names = groups?.map((group) =>
    group.length === 1 && group[0]!.name === "VariableName"
      ? text(code, group[0]!)
      : undefined,
  );
  return names?.length === 2 && names[0] === variable && names[1] === driver;
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
  const { variable } = metadata;
  const display = `${widget}(${variable}, ${metadata.driver})`;
  const graph = graphName(variable);
  return [
    ...metadata.comments,
    `${variable} = ${metadata.driver}.execute_query(\n` +
      `${indent}${prefix}"""\n${body}\n${indent}""",\n${args})`,
    ...(metadata.graph ? [`${graph} = mo.ui.anywidget(${display})`, graph] : [display]),
  ].join("\n");
}

/**
 * Creates the Python for a new Cypher cell, by default binding {@link defaultVariable}.
 *
 * The cell binds its widget to {@link graphName}, so the notebook must define `mo`.
 */
export function create({
  driver = "driver",
  cypher = "",
  variable = defaultVariable,
}: { driver?: string; cypher?: string; variable?: string } = {}): string {
  return write(cypher, { variable, driver, args: [], comments: [], graph: true });
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

/** Whether `name` is a Python identifier that a Cypher cell can bind. */
export function isName(name: string): boolean {
  return identifier.test(name) && !keywords.has(name);
}

/** Whether marimo keeps `name` local to its cell, so other cells cannot clash with it. */
export function isPrivate(name: string): boolean {
  return name.startsWith("_");
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
