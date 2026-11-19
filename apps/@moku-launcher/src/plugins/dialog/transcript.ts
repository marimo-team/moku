/**
 * Read and write the conversational turn stored in a dialog cell's source.
 *
 * A dialog cell holds one turn, a person's prompt and the agent's reply, as a
 * Python dictionary that marimo renders without other packages. Every value is
 * written with `JSON.stringify`, whose string escapes Python reads with the same
 * meaning, which lets the dictionary be parsed back as JSON.
 *
 * @module
 */
import { Option, Schema } from "effect";

/** One prompt from the person and the agent's reply to it. */
export const Turn = Schema.Struct({
  /** Markdown written by the person. */
  prompt: Schema.String,
  /** Markdown written by the agent, empty until its turn ends. */
  reply: Schema.String,
  /** Names of cells the agent created or changed while answering, or ids for unnamed ones. */
  cells: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type Turn = typeof Turn.Type;

const marker = "# moku:dialog";
const assignment = "_turn = {";
const decode = Schema.decodeUnknownOption(Turn);

/** Whether a cell's source declares itself a dialog, even if its turn no longer parses. */
export function isDialog(code: string | null): boolean {
  return code?.trimStart().split("\n", 1)[0]?.trim() === marker;
}

/**
 * Reads the turn from a dialog cell's source.
 *
 * Returns none when the source is not a dialog or was edited into a form other
 * than a JSON-compatible dictionary, in which case views should show it as code.
 */
export function parse(code: string | null): Option.Option<Turn> {
  if (code === null || !isDialog(code)) return Option.none();
  const start = code.indexOf(assignment);
  if (start === -1) return Option.none();
  const open = start + assignment.length - 1;
  const close = code.indexOf("\n}", open);
  if (close === -1) return Option.none();
  try {
    return decode(JSON.parse(withoutTrailingCommas(code.slice(open, close + 2))));
  } catch {
    return Option.none();
  }
}

/**
 * Writes the source of a dialog cell holding `turn`.
 *
 * The cell renders the prompt as a bubble followed by the reply, so the
 * conversation reads the same in marimo's own editor and in a diff.
 */
export function serialize(turn: Turn): string {
  const fields = Object.entries(turn).map(([key, value]) => {
    const encoded = Array.isArray(value)
      ? `[${value.map((item) => JSON.stringify(item)).join(", ")}]`
      : JSON.stringify(value);
    return `    ${JSON.stringify(key)}: ${encoded},`;
  });
  return [
    marker,
    "import marimo as _mo",
    "",
    assignment,
    ...fields,
    "}",
    "_mo.vstack([",
    `    _mo.md(_turn["prompt"]).style(${promptStyle}),`,
    '    _mo.md(_turn["reply"] or "*Waiting for the agent…*"),',
    "])",
  ].join("\n");
}

/**
 * The prompt bubble's inline style.
 *
 * Its colors read `--dialog-prompt-*` variables, which inherit into marimo's
 * output, so a view can theme the bubble. The fallbacks serve marimo's editor.
 */
const promptStyle = JSON.stringify({
  "margin-left": "auto",
  "max-width": "85%",
  padding: "0.5rem 0.9rem",
  "border-radius": "12px",
  background: "var(--dialog-prompt-background, light-dark(#f2efe9, #2a2826))",
  border: "1px solid var(--dialog-prompt-border, light-dark(#e6e0d6, #3a3631))",
});

/** Python allows a comma before a closing bracket, which JSON does not. */
function withoutTrailingCommas(source: string) {
  let result = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      result += character;
      if (character === "\\") result += source[++index] ?? "";
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    if (character === "," && /^\s*[\]}]/.test(source.slice(index + 1))) continue;
    result += character;
  }
  return result;
}
