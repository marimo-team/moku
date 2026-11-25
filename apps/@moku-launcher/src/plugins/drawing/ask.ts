/**
 * Asking Claude for a cell: what it is told about the notebook, and checking what comes back.
 *
 * The dev server's `/__sketcher/ask` route runs `claude -p` with fixed arguments (see
 * `vite/askBridge.ts`) and returns its raw output, the same way the
 * board's LaTeX conversion works, so parsing, retries and error messages live here.
 *
 * @module
 */
import { Option, Schema } from "effect";
import { type ClaudeReply, RecognizerError, explain, parseStructured } from "sketcher";

/** A cell as Claude sees it. */
export interface CellContext {
  readonly name: string;
  readonly code: string;
  /** Names the cell defines. */
  readonly defs: readonly string[];
  /** Names the cell reads from other cells. */
  readonly refs: readonly string[];
}

export interface VariableContext {
  readonly name: string;
  readonly type: string | null;
  readonly preview: string | null;
}

/** One request, with everything Claude is told. */
export interface Request {
  readonly prompt: string;
  /** The selection as a base64 PNG. */
  readonly png: string;
  /** The whole board with the selection outlined, as a base64 PNG. */
  readonly context: string;
  /** Roughly how big the output should be, in CSS pixels. */
  readonly size: { readonly w: number; readonly h: number };
  readonly cells: readonly CellContext[];
  readonly variables: readonly VariableContext[];
  /** The cell to change, when one card is selected. */
  readonly target: CellContext | null;
  /** Cards in the selection, by cell name. */
  readonly selected: readonly string[];
  /** Arrows drawn between the selection (`null`) and cells around it, by cell name. */
  readonly arrows: readonly {
    readonly from: string | null;
    readonly to: string | null;
  }[];
}

/** Cells an arrow from the selection points into: the answer must rewire them. */
function fed(request: Pick<Request, "arrows" | "cells" | "target">): string[] {
  const names = new Set(request.cells.map((c) => c.name));
  return [
    ...new Set(
      request.arrows.flatMap((a) =>
        a.from === null &&
        a.to !== null &&
        a.to !== request.target?.name &&
        names.has(a.to)
          ? [a.to]
          : [],
      ),
    ),
  ];
}

/** Another cell an answer rewrites, because an arrow from the new cell points into it. */
const Update = Schema.Struct({ name: Schema.String, code: Schema.String });

/** What Claude answers, as `ask.json`'s schema describes it. */
export const Answer = Schema.Struct({
  action: Schema.Literals(["create", "edit"]),
  name: Schema.String,
  title: Schema.String,
  code: Schema.String,
  defines: Schema.Array(Schema.String),
  updates: Schema.optionalKey(Schema.Array(Update)),
});
export type Answer = typeof Answer.Type;

/**
 * Sends the pictures and request text to the dev server and returns Claude's raw reply. `mode`
 * picks the instructions: writing a cell from a sketch, or connecting two cells.
 */
export type Transport = (
  body: { png: string; context: string; text: string; mode?: "cell" | "connect" },
  signal: AbortSignal,
) => Promise<ClaudeReply>;

/** The dev server route installed by the launcher's `drawing()` Vite plugin. */
export const fetchTransport: Transport = async (body, signal) => {
  const response = await fetch("/__sketcher/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 404) {
    return {
      error: "unavailable",
      message:
        "This dev server has no /__sketcher/ask route. Start it with `bun dev`, which installs the Drawing view's Vite plugin.",
    };
  }
  return (await response.json()) as ClaudeReply;
};

const PYTHON_KEYWORDS = new Set(
  (
    "False None True and as assert async await break class continue def del elif else except finally for from " +
    "global if import in is lambda nonlocal not or pass raise return try while with yield match case type"
  ).split(" "),
);

const isIdentifier = (name: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !PYTHON_KEYWORDS.has(name);

/** Turns whatever Claude suggested into a usable cell name. */
export function cellName(suggested: string): string {
  const cleaned = suggested
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  const name = /^[0-9]/.test(cleaned) ? `cell_${cleaned}` : cleaned;
  return isIdentifier(name) && !name.startsWith("sketcher_") ? name : "cell";
}

/** Names other cells define, which a new or edited cell must not assign again. */
function globals(request: Pick<Request, "cells" | "target">): Set<string> {
  const names = new Set<string>();
  for (const cell of request.cells) {
    if (cell.name === request.target?.name) continue;
    for (const name of cell.defs) names.add(name);
  }
  return names;
}

const BUDGET = 24_000;

/** The text part of the request: the ask, the mode, and the notebook around it. */
export function describe(request: Request, note: string | null = null): string {
  const { target } = request;
  const glob = [...globals(request)].sort();
  const asked = request.prompt.trim();
  const lines = [
    `Request: ${
      asked ||
      (target
        ? "(none: notes on the card, and arrows into it from other cells, say what to change)"
        : "(none: work out from the picture alone what this sketch should become)")
    }`,
    "",
    target
      ? `Mode: edit the cell \`${target.name}\` (its card is selected).`
      : "Mode: create a new cell.",
    request.selected.length > 0 && !target
      ? `Selected cells: ${request.selected.join(", ")}`
      : null,
    `Target output size: about ${Math.round(request.size.w)}×${Math.round(request.size.h)} px.`,
    request.arrows.length > 0
      ? `Arrows drawn on the board: ${request.arrows
          .map(
            (a) =>
              `from ${a.from === null ? "the selection" : `cell \`${a.from}\``} into ${a.to === null ? "the selection" : `cell \`${a.to}\``}`,
          )
          .join("; ")}.`
      : null,
    fed(request).length > 0
      ? `So the new thing feeds ${fed(request)
          .map((n) => `\`${n}\``)
          .join(", ")}: rewrite each under updates to use it.`
      : null,
    "",
    `Globals (defined by other cells; use them, never assign or import them again): ${glob.join(", ") || "(none)"}`,
  ].filter((l): l is string => l !== null);

  if (request.variables.length > 0) {
    lines.push("", "Variables in the running kernel:");
    for (const v of request.variables.slice(0, 80)) {
      const preview = v.preview
        ? ` = ${v.preview.length > 120 ? `${v.preview.slice(0, 119)}…` : v.preview}`
        : "";
      lines.push(`- ${v.name}${v.type ? `: ${v.type}` : ""}${preview}`);
    }
  }

  // The target, the cells it reads and the cells to rewire go in full; the rest as far as the
  // budget allows.
  const close = new Set([
    target?.name,
    ...fed(request),
    ...(target?.refs.flatMap((r) =>
      request.cells.filter((c) => c.defs.includes(r)).map((c) => c.name),
    ) ?? []),
  ]);
  let budget = BUDGET;
  lines.push("", "Cells, in notebook order:");
  for (const cell of request.cells) {
    const head = `### ${cell.name}${cell.defs.length ? ` (defines ${cell.defs.join(", ")})` : ""}`;
    let code = cell.code;
    if (!close.has(cell.name) && code.length > budget) {
      code = `${code.split("\n").slice(0, 6).join("\n")}\n# …`;
    }
    budget = Math.max(0, budget - code.length);
    lines.push(head, "```python", code, "```");
  }
  if (target)
    lines.push(
      "",
      `Current code of \`${target.name}\`:`,
      "```python",
      target.code,
      "```",
    );
  if (note) lines.push("", note);
  return lines.join("\n");
}

/** Why an answer can't be used as it is, or null if it can. */
function problem(answer: Answer, request: Request): string | null {
  if (!answer.code.trim()) return "The code was empty.";
  const missing = fed(request).filter(
    (name) => !(answer.updates ?? []).some((u) => u.name === name && u.code.trim()),
  );
  if (missing.length > 0) {
    return `An arrow points from the selection into ${missing.map((n) => `\`${n}\``).join(", ")}, so ${missing.length > 1 ? "those cells" : "that cell"} must start using what you made: give it a global name and list each under updates with its complete new code.`;
  }
  const clash = answer.defines.filter((name) => globals(request).has(name));
  if (clash.length > 0) {
    return `The code assigns ${clash.map((n) => `\`${n}\``).join(", ")}, which other cells already define. Use them as they are, or give new values different names (a leading underscore keeps a name private to the cell).`;
  }
  return null;
}

/**
 * Calls Claude through `transport`. If the answer clashes with the notebook, Claude gets one more
 * try. `cells` gives the notebook's cells as they are now: another ask may have added some while
 * Claude worked on this one, so answers are checked against those rather than the ones it was told.
 */
export async function run(
  request: Request,
  transport: Transport,
  signal: AbortSignal,
  cells: () => readonly CellContext[] = () => request.cells,
): Promise<Answer> {
  const first = await once(request, null, transport, signal);
  const now = { ...request, cells: cells() };
  const issue = problem(first, now);
  if (!issue) return first;
  const note = `Your previous answer had a problem: ${issue}\nPrevious code:\n\`\`\`python\n${first.code}\n\`\`\``;
  try {
    const second = await once(now, note, transport, signal);
    if (!problem(second, { ...request, cells: cells() })) return second;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  // marimo will point out what's still wrong, and the card offers to fix it.
  return first;
}

// MARK: Connecting two cells

/** A helper cell a connection brings along: glue code with no card of its own. */
export interface HelperCell {
  readonly name: string;
  readonly code: string;
}

/** A wire drawn from one card to another, and what the person wants it to do. */
export interface ConnectRequest {
  readonly prompt: string;
  /** The whole board with both cards outlined, as a base64 PNG. */
  readonly context: string;
  readonly source: CellContext;
  readonly sink: CellContext;
  readonly cells: readonly CellContext[];
  readonly variables: readonly VariableContext[];
  /** Helper cells the connection has now, when it's asked about again (or undone). */
  readonly helpers: readonly HelperCell[];
  /** `disconnect`: undo the connection instead. */
  readonly mode: "connect" | "disconnect";
}

/** What Claude answers to a connect request, as `ask.json`'s `connect.schema` describes it. */
export const ConnectAnswer = Schema.Struct({
  sink_code: Schema.String,
  /** Empty when the source stays as it is. */
  source_code: Schema.String,
  helpers: Schema.Array(Update),
  label: Schema.String,
  defines: Schema.Array(Schema.String),
});
export type ConnectAnswer = typeof ConnectAnswer.Type;

const identifiers = (code: string): Set<string> =>
  new Set(code.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);

/** Names other cells define, apart from the two being connected and the connection's helpers. */
function connectGlobals(request: ConnectRequest): Set<string> {
  const own = new Set([
    request.source.name,
    request.sink.name,
    ...request.helpers.map((h) => h.name),
  ]);
  const names = new Set<string>();
  for (const cell of request.cells) {
    if (own.has(cell.name)) continue;
    for (const name of cell.defs) names.add(name);
  }
  return names;
}

/** The text part of a connect request. */
export function describeConnect(
  request: ConnectRequest,
  note: string | null = null,
): string {
  const { source, sink } = request;
  const asked = request.prompt.trim();
  const glob = [...connectGlobals(request)].sort();
  const lines: string[] =
    request.mode === "disconnect"
      ? [
          `Request: remove the connection from \`${source.name}\` to \`${sink.name}\`.`,
          "",
          `Mode: disconnect. Rewrite \`${sink.name}\` so it no longer reads anything from \`${source.name}\`${
            request.helpers.length > 0
              ? ` or from the helper cells ${request.helpers.map((h) => `\`${h.name}\``).join(", ")} (they are being deleted)`
              : ""
          }, keeping what it shows otherwise. Answer with no helpers, an empty source_code and an empty label.`,
        ]
      : [
          `Request: ${asked || "(none: pick the most useful way for the source to drive the sink)"}`,
          "",
          `Mode: connect. A wire was drawn from the cell \`${source.name}\` (the source) to the cell \`${sink.name}\` (the sink): the sink must start using the source.`,
          `The source defines: ${source.defs.join(", ") || "(nothing yet: give what it shows a global name in source_code)"}.`,
          request.helpers.length > 0
            ? `The connection has these helper cells now: ${request.helpers.map((h) => `\`${h.name}\``).join(", ")}. List the ones to keep (rewritten as needed) under helpers; the rest are deleted.`
            : "",
        ];
  lines.push(
    "",
    `Globals of other cells (use them, never assign them): ${glob.join(", ") || "(none)"}`,
  );
  if (request.variables.length > 0) {
    lines.push("", "Variables in the running kernel:");
    for (const v of request.variables.slice(0, 80)) {
      const preview = v.preview
        ? ` = ${v.preview.length > 120 ? `${v.preview.slice(0, 119)}…` : v.preview}`
        : "";
      lines.push(`- ${v.name}${v.type ? `: ${v.type}` : ""}${preview}`);
    }
  }
  const close = new Set([
    source.name,
    sink.name,
    ...request.helpers.map((h) => h.name),
  ]);
  let budget = BUDGET;
  lines.push("", "Other cells, in notebook order:");
  for (const cell of request.cells) {
    if (close.has(cell.name)) continue;
    let code = cell.code;
    if (code.length > budget) code = `${code.split("\n").slice(0, 6).join("\n")}\n# …`;
    budget = Math.max(0, budget - code.length);
    lines.push(
      `### ${cell.name}${cell.defs.length ? ` (defines ${cell.defs.join(", ")})` : ""}`,
      "```python",
      code,
      "```",
    );
  }
  lines.push("", `Source \`${source.name}\`:`, "```python", source.code, "```");
  for (const h of request.helpers)
    lines.push("", `Helper \`${h.name}\`:`, "```python", h.code, "```");
  lines.push("", `Sink \`${sink.name}\`:`, "```python", sink.code, "```");
  if (note) lines.push("", note);
  return lines.filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
}

/** Why a connect answer can't be used as it is, or null if it can. */
export function connectProblem(
  answer: ConnectAnswer,
  request: ConnectRequest,
  taken: (name: string) => boolean = () => false,
): string | null {
  if (!answer.sink_code.trim())
    return `The code for \`${request.sink.name}\` was empty.`;
  const sourceNames = new Set([
    ...request.source.defs,
    ...(answer.source_code.trim() ? answer.defines : []),
  ]);
  if (request.mode === "disconnect") {
    const still = [...identifiers(answer.sink_code)].filter((n) =>
      request.source.defs.includes(n),
    );
    return still.length > 0
      ? `\`${request.sink.name}\` still reads ${still.map((n) => `\`${n}\``).join(", ")} from \`${request.source.name}\`.`
      : null;
  }
  const reads = identifiers(
    [answer.sink_code, ...answer.helpers.map((h) => h.code)].join("\n"),
  );
  if (![...sourceNames].some((n) => reads.has(n))) {
    return `Nothing reads from \`${request.source.name}\`: \`${request.sink.name}\` (directly, or through a helper cell) must use one of ${[...sourceNames].map((n) => `\`${n}\``).join(", ") || "the names the source defines (give it one in source_code)"}.`;
  }
  const own = new Set([
    request.source.name,
    request.sink.name,
    ...request.helpers.map((h) => h.name),
  ]);
  for (const h of answer.helpers) {
    if (!isIdentifier(h.name) || h.name.startsWith("sketcher_"))
      return `\`${h.name}\` isn't a usable helper cell name: use a snake_case Python identifier.`;
    if (!own.has(h.name) && taken(h.name))
      return `A cell called \`${h.name}\` already exists: give the helper another name.`;
    if (!h.code.trim()) return `The helper \`${h.name}\` was empty.`;
  }
  const clash = answer.defines.filter((name) => connectGlobals(request).has(name));
  if (clash.length > 0) {
    return `The code assigns ${clash.map((n) => `\`${n}\``).join(", ")}, which other cells already define. Use them as they are, or pick new names (a leading underscore keeps a name private to its cell).`;
  }
  return null;
}

/** Calls Claude through `transport` to connect (or disconnect) two cells, with one retry. */
export async function runConnect(
  request: ConnectRequest,
  transport: Transport,
  signal: AbortSignal,
  taken: (name: string) => boolean = () => false,
): Promise<ConnectAnswer> {
  const first = await onceConnect(request, null, transport, signal);
  const issue = connectProblem(first, request, taken);
  if (!issue) return first;
  const note = `Your previous answer had a problem: ${issue}\nPrevious answer:\n\`\`\`json\n${JSON.stringify(first, null, 2)}\n\`\`\``;
  try {
    const second = await onceConnect(request, note, transport, signal);
    if (!connectProblem(second, request, taken)) return second;
  } catch (error) {
    if (signal.aborted) throw error;
  }
  return first;
}

async function onceConnect(
  request: ConnectRequest,
  note: string | null,
  transport: Transport,
  signal: AbortSignal,
): Promise<ConnectAnswer> {
  const reply = await transport(
    {
      png: request.context,
      context: request.context,
      text: describeConnect(request, note),
      mode: "connect",
    },
    signal,
  );
  const answer = Schema.decodeUnknownOption(ConnectAnswer)(structuredReply(reply));
  if (Option.isNone(answer))
    throw new RecognizerError("failed", "Claude's answer wasn't a connection.");
  return answer.value;
}

/** Claude's structured output, or the error the reply stands for. */
function structuredReply(reply: ClaudeReply): Record<string, unknown> | null {
  if ("error" in reply) {
    switch (reply.error) {
      case "not_found":
        throw new RecognizerError("notFound");
      case "timeout":
        throw new RecognizerError("timedOut");
      case "unavailable":
        throw new RecognizerError("unavailable", reply.message);
      default:
        throw new RecognizerError("failed", reply.message ?? "Couldn't run Claude.");
    }
  }
  try {
    return parseStructured(reply.stdout);
  } catch (error) {
    if (error instanceof RecognizerError)
      throw explain(error, reply.stderr, reply.status);
    throw error;
  }
}

async function once(
  request: Request,
  note: string | null,
  transport: Transport,
  signal: AbortSignal,
): Promise<Answer> {
  const reply = await transport(
    { png: request.png, context: request.context, text: describe(request, note) },
    signal,
  );
  const answer = Schema.decodeUnknownOption(Answer)(structuredReply(reply));
  if (Option.isNone(answer))
    throw new RecognizerError("failed", "Claude's answer wasn't a cell.");
  return answer.value;
}
