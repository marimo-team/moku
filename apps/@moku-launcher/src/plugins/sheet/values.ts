/**
 * What each grid cell shows, read from the notebook's analysis, executions,
 * and variables.
 *
 * Nothing here computes a value. The host evaluates every cell and publishes
 * the variable named after its address, and this module turns that into a
 * short text or a spreadsheet-style error label.
 *
 * @module
 */
import * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/Protocol";
import * as NotebookOutputs from "../notebook/outputs.ts";
import * as Formula from "./formula.ts";

/** The content of one grid cell. */
type Display =
  | { readonly kind: "blank" }
  /** A formula the current runtime has not evaluated, shown as typed. */
  | { readonly kind: "formula"; readonly text: string }
  | { readonly kind: "value"; readonly text: string; readonly numeric: boolean }
  /** A value with no short text form, such as Markdown, rendered by the host's output. */
  | {
      readonly kind: "rich";
      readonly data: typeof Protocol.Media.Type;
      readonly runtimeId: string | null;
    }
  | { readonly kind: "error"; readonly label: string; readonly message: string };

/** A grid cell's content and whether the host is evaluating it again. */
export interface Cell {
  readonly display: Display;
  readonly busy: boolean;
  /** The execution whose full output belongs to this cell, when there is one. */
  readonly executionId: string | null;
}

/** The parts of a placed cell this module reads. Its name is its address. */
export interface Source {
  readonly name: string;
  readonly code: string | null;
}

/** Displays by marimo cell id, with what is needed to derive the next selection. */
export interface Selection {
  readonly outputs: NotebookOutputs.Selection;
  readonly cells: ReadonlyMap<string, Cell>;
}

const blank: Display = { kind: "blank" };

/**
 * Derives every grid cell's display from the notebook state.
 *
 * A cell the current runtime has not evaluated for its current source shows
 * that source instead. A constant shows as its value, which needs no
 * evaluation, and a formula shows as typed until the host computes it.
 *
 * The host removes a cell's execution and variables before it publishes the
 * next one, so pass the previous selection to keep showing the old value while
 * a cell is being evaluated again.
 */
export function select(
  state: Notebook.State,
  placed: ReadonlyMap<string, Source>,
  previous?: Selection,
): Selection {
  const outputs = NotebookOutputs.select(state, previous?.outputs);
  const analysis =
    state.analysis !== null && state.analysis.document_etag === state.document?.etag
      ? state.analysis.cells
      : {};
  const confirmed = state.document ? Notebook.cellIndex(state.document) : null;
  const variables = new Map<string, typeof Protocol.Variable.Type>();
  for (const variable of Object.values(state.variables))
    variables.set(`${variable.execution_id}\n${variable.name}`, variable);

  const cells = new Map<string, Cell>();
  for (const [id, source] of placed) {
    const address = source.name;
    const current = outputs.current.get(id);
    const result = outputs.results.get(id);
    const busy = current !== undefined && current.state.status !== "completed";
    const invalid = analysis[id]?.diagnostics.find(
      (error) => error.severity === "error",
    );
    const before = previous?.cells.get(id);
    const display = invalid
      ? analysisError(invalid)
      : result === undefined
        ? fromSource(source)
        : // A result retained from before its removal has lost its variables.
          state.executions[result.id] === undefined && before !== undefined
          ? before.display
          : (outcome(
              result,
              outputs.resultOutputs.get(result.id)?.media ?? null,
              variables.get(`${result.id}\n${address}`),
              confirmed?.get(id)?.code_fingerprint,
            ) ?? fromSource(source));
    cells.set(id, { display, busy, executionId: result?.id ?? current?.id ?? null });
  }
  return { outputs, cells };
}

function fromSource({ name, code }: Source): Display {
  const input = code === null ? null : Formula.toInput(name, code);
  if (input === null) return blank;
  if (input.startsWith("=")) return { kind: "formula", text: input };
  return { kind: "value", text: input, numeric: Formula.isNumber(input) };
}

function analysisError(
  error: (typeof Protocol.CellAnalysis.Type)["diagnostics"][number],
): Display {
  const label =
    error.kind === "cycle-dependencies"
      ? "#CYCLE!"
      : error.kind === "multiple-definitions"
        ? "#DUP!"
        : "#SYNTAX!";
  return { kind: "error", label, message: error.message };
}

const exceptions: Record<string, string> = {
  ZeroDivisionError: "#DIV/0!",
  NameError: "#NAME?",
  TypeError: "#VALUE!",
  ValueError: "#VALUE!",
};

function outcome(
  execution: typeof Protocol.Execution.Type,
  media: typeof Protocol.Media.Type | null,
  variable: typeof Protocol.Variable.Type | undefined,
  fingerprint: string | null | undefined,
): Display | null {
  if (execution.state.status !== "completed") return blank;
  const result = execution.state.outcome;
  switch (result.kind) {
    case "succeeded":
      break;
    case "failed":
      return {
        kind: "error",
        label: exceptions[result.error.name ?? ""] ?? "#ERROR!",
        message: result.error.name
          ? `${result.error.name}: ${result.error.message}`
          : result.error.message,
      };
    case "skipped":
      return { kind: "error", label: "#BLOCKED!", message: result.message };
    case "cancelled":
      return {
        kind: "error",
        label: "#STOPPED!",
        message: "Evaluation was interrupted.",
      };
    default:
      return blank;
  }
  // An edited cell that has not run again must not show the value of its old source.
  if (fingerprint != null && execution.code_fingerprint !== fingerprint) return null;
  // Plain values, such as numbers, strings, and lists of numbers, show their
  // preview. Anything else shows the cell's rendered output: Markdown, figures,
  // and widgets, whose preview is their current value rather than the widget.
  if (variable?.preview != null && plain(variable.type, variable.preview))
    return {
      kind: "value",
      text: variable.type === "str" ? unquote(variable.preview) : variable.preview,
      numeric: /^(int|float|complex|Decimal)/.test(variable.type ?? ""),
    };
  if (media !== null && media.mimetype !== "text/plain")
    return { kind: "rich", data: media, runtimeId: execution.runtime_id };
  return {
    kind: "value",
    text: variable?.type ?? plainText(media),
    numeric: false,
  };
}

const plainTypes = new Set([
  "NoneType",
  "bool",
  "Decimal",
  "Fraction",
  "date",
  "datetime",
  "time",
  "timedelta",
  "list",
  "tuple",
  "dict",
  "set",
  "frozenset",
]);

/** Whether a value of this type is shown as its preview text rather than its output. */
function plain(type: string | null, preview: string): boolean {
  if (type === "str" || type === "str_") return true;
  if (type === null) return false;
  const scalar = /^(u?int|float|complex|bool_)\d*$/.test(type) || plainTypes.has(type);
  // A container of objects, such as the lines `plt.plot` returns, previews as markup.
  return scalar && !preview.includes("<");
}

/** The text inside a Python string repr, for strings without unusual escapes. */
function unquote(preview: string): string {
  const quote = preview[0];
  if (
    preview.length < 2 ||
    (quote !== "'" && quote !== '"') ||
    !preview.endsWith(quote)
  )
    return preview;
  return preview
    .slice(1, -1)
    .replace(/\\(['"\\nt])/g, (_, char: string) =>
      char === "n" ? "\n" : char === "t" ? "\t" : char,
    );
}

function plainText(media: typeof Protocol.Media.Type | null): string {
  return media?.data.trim() ?? "";
}
