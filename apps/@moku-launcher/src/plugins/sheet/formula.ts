/**
 * Conversion between what a person types into a grid cell and the Python
 * source of the marimo cell behind it.
 *
 * Input follows the spreadsheet convention. A leading `=` introduces a Python
 * expression, a number stays a number, and anything else is text.
 *
 * A formula cell ends with its own name as the last expression. That makes the
 * value the cell's output, so rich values such as tables or Markdown render in
 * this view and in any other notebook client.
 *
 * A range such as `B2:B6` is written as the list `[B2, B3, B4, B5, B6]`, and a
 * block such as `B2:C3` as a list of rows, so marimo sees every address as a
 * reference. The formula bar shows these lists as ranges again.
 *
 * @module
 */
import * as Address from "./address.ts";

// Python rejects integers with leading zeros, so `007` is treated as text.
const number = /^[+-]?(?:(?:0|[1-9]\d*)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Whether typed text is a number, as opposed to text. */
export function isNumber(text: string): boolean {
  return number.test(text.trim());
}

/**
 * The Python source that assigns the typed input to the address.
 *
 * Returns null for blank input, which means the cell should not exist.
 */
export function toSource(address: string, input: string): string | null {
  const text = input.trim();
  if (text === "") return null;
  if (text.startsWith("=")) {
    const expression = text.slice(1).trim();
    return expression === ""
      ? null
      : `${address} = ${outsideStrings(expression, expand)}\n${address}`;
  }
  if (number.test(text)) return `${address} = ${text}`;
  // JSON string escapes are a subset of Python's, so the literal is valid Python.
  return `${address} = ${JSON.stringify(text)}`;
}

/**
 * The input that produces this source, as shown in the formula bar.
 *
 * Returns null when the source is not a single assignment to the address,
 * optionally followed by the address as the last expression. Such cells can
 * only be edited as Python.
 */
export function toInput(address: string, code: string): string | null {
  const lines = code.trim().split("\n");
  if (lines.length > 1 && lines.at(-1)?.trim() === address) lines.pop();
  const source = joinWrapped(lines);
  if (source === null) return null;
  const prefix = new RegExp(`^${address}\\s*=(?!=)\\s*`).exec(source);
  if (!prefix) return null;
  const expression = source.slice(prefix[0].length).trim();
  if (expression === "") return null;
  const literal = plain(expression);
  // Text that would be read back as a number or a formula keeps its quotes.
  return literal !== null && toSource(address, literal) === `${address} = ${expression}`
    ? literal
    : `=${outsideStrings(expression, collapse)}`;
}

/**
 * Joins lines that a formatter wrapped inside brackets into one line, or
 * returns null when a line ends outside brackets, which means another statement.
 */
function joinWrapped(lines: readonly string[]): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (const [index, line] of lines.entries()) {
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (quote) {
        if (char === "\\") i++;
        else if (char === quote) quote = null;
      } else if (char === "#") break;
      else if (char === '"' || char === "'") {
        // Triple-quoted strings can span lines, which this does not follow.
        if (line.startsWith(char.repeat(3), i)) return null;
        quote = char;
      } else if ("([{".includes(char)) depth++;
      else if (")]}".includes(char)) depth--;
    }
    if (quote || (index < lines.length - 1 && depth <= 0)) return null;
  }
  return lines
    .map((line) => line.trim())
    .join(" ")
    .replace(/([([{]) /g, "$1")
    .replace(/ ([)\]}])/g, "$1");
}

/** The value of an expression that is exactly a number or a text literal. */
function plain(expression: string): string | null {
  if (number.test(expression)) return expression;
  if (!expression.startsWith('"')) return null;
  try {
    const value: unknown = JSON.parse(expression);
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

// String literals, including f-strings, whose format specs can look like ranges.
const strings =
  /("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')/;

function outsideStrings(expression: string, transform: (code: string) => string) {
  return expression
    .split(strings)
    .map((part, index) => (index % 2 === 1 ? part : transform(part)))
    .join("");
}

const cell = "[A-Z][1-9]\\d{0,2}";
const rangePattern = new RegExp(`\\b(${cell}):(${cell})\\b`, "g");
const listPattern = new RegExp(`\\[\\s*(${cell}(?:\\s*,\\s*${cell})+)\\s*\\]`, "g");
const blockPattern = new RegExp(
  `\\[\\s*(\\[[A-Z0-9,\\s]+\\](?:\\s*,\\s*\\[[A-Z0-9,\\s]+\\])+)\\s*\\]`,
  "g",
);

/** Ranges larger than this stay as typed, so a typo cannot write a huge list. */
const largest = 1000;

function expand(code: string): string {
  return code.replace(rangePattern, (match, from: string, to: string) => {
    const a = Address.parse(from);
    const b = Address.parse(to);
    if (!a || !b) return match;
    const cols = [Math.min(a.col, b.col), Math.max(a.col, b.col)] as const;
    const rows = [Math.min(a.row, b.row), Math.max(a.row, b.row)] as const;
    if ((cols[1] - cols[0] + 1) * (rows[1] - rows[0] + 1) > largest) return match;
    const line = (row: number, first = cols[0], last = cols[1]) =>
      Array.from({ length: last - first + 1 }, (_, i) =>
        Address.format({ col: first + i, row }),
      );
    if (cols[0] === cols[1])
      return `[${Array.from({ length: rows[1] - rows[0] + 1 }, (_, i) =>
        Address.format({ col: cols[0], row: rows[0] + i }),
      ).join(", ")}]`;
    if (rows[0] === rows[1]) return `[${line(rows[0]).join(", ")}]`;
    return `[${Array.from(
      { length: rows[1] - rows[0] + 1 },
      (_, i) => `[${line(rows[0] + i).join(", ")}]`,
    ).join(", ")}]`;
  });
}

function collapse(code: string): string {
  return code
    .replace(blockPattern, (match, inner: string) => {
      const lines = [...inner.matchAll(/\[([^\]]*)\]/g)].map((line) =>
        line[1]!.split(",").map((name) => Address.parse(name.trim())),
      );
      const first = lines[0]?.[0];
      const width = lines[0]?.length ?? 0;
      const block =
        first != null &&
        width > 1 &&
        lines.every(
          (line, r) =>
            line.length === width &&
            line.every(
              (position, c) =>
                position?.col === first.col + c && position.row === first.row + r,
            ),
        );
      if (!block) return match;
      const last = { col: first.col + width - 1, row: first.row + lines.length - 1 };
      return `${Address.format(first)}:${Address.format(last)}`;
    })
    .replace(listPattern, (match, inner: string) => {
      const positions = inner.split(",").map((name) => Address.parse(name.trim()));
      const [first] = positions;
      if (!first) return match;
      const down = positions.every(
        (position, i) => position?.col === first.col && position.row === first.row + i,
      );
      const across = positions.every(
        (position, i) => position?.row === first.row && position.col === first.col + i,
      );
      if (!down && !across) return match;
      return `${Address.format(first)}:${Address.format(positions.at(-1)!)}`;
    });
}
