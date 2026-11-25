// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/math/recognizer.ts. Edit it there and rerun scripts/sketcher.ts.
// Handwriting → LaTeX through the `claude` CLI (`claude -p`), run by a host process: the Python
// kernel in a notebook, or the Vite dev server for the standalone page. The host only runs the
// CLI with fixed arguments (see python/src/sketcher/claude.json) and hands back its raw output;
// parsing, retries and error messages live here so every host behaves the same.

/** One request to the host: a PNG (base64) and an optional extra note for the prompt. */
export interface ClaudeRequest {
  png: string;
  note: string | null;
}

/** What the host sends back: the CLI's output, or a host-level error. */
export type ClaudeReply =
  | { stdout: string; stderr: string; status: number }
  | { error: "not_found" | "timeout" | "unavailable" | "failed"; message?: string };

export type RunClaude = (request: ClaudeRequest) => Promise<ClaudeReply>;

export type RecognizerErrorKind = "notFound" | "notLoggedIn" | "timedOut" | "empty" | "unavailable" | "failed";

export class RecognizerError extends Error {
  constructor(readonly kind: RecognizerErrorKind, detail = "") {
    super(RecognizerError.describe(kind, detail));
  }

  static describe(kind: RecognizerErrorKind, detail: string): string {
    switch (kind) {
      case "notFound":
        return "Couldn't find Claude Code. Install it (claude.com/claude-code), or pass claude_path= to Sketcher().";
      case "notLoggedIn":
        return "Claude Code isn't logged in. Run `claude` in a terminal once and log in, then try again.";
      case "timedOut":
        return "Claude took too long to answer. Try again, or select less at once.";
      case "empty":
        return "Claude didn't find any math in the selection.";
      case "unavailable":
        return detail || "LaTeX conversion needs a Python kernel (or the dev server) to run Claude.";
      case "failed":
        return detail;
    }
  }
}

/** Removes delimiters and wrappers models sometimes add anyway. */
export function cleanLatex(input: string): string {
  let s = input.trim();
  if (s.startsWith("```")) {
    const lines = s.split(/\r?\n/);
    lines.shift();
    if (lines.at(-1)?.trim().startsWith("```")) lines.pop();
    s = lines.join("\n").trim();
  }
  const pairs: [string, string][] = [
    ["$$", "$$"], ["\\[", "\\]"], ["\\(", "\\)"], ["$", "$"],
    ["\\begin{equation*}", "\\end{equation*}"], ["\\begin{equation}", "\\end{equation}"],
    ["\\begin{displaymath}", "\\end{displaymath}"],
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of pairs) {
      if (s.length >= open.length + close.length && s.startsWith(open) && s.endsWith(close)) {
        s = s.slice(open.length, s.length - close.length).trim();
        changed = true;
      }
    }
  }
  return s;
}

/** The final `result` event of `claude -p --output-format stream-json` output. Throws if it failed. */
export function findResult(stdout: string): Record<string, unknown> {
  let result: Record<string, unknown> | null = null;
  for (const line of stdout.split(/\r?\n/).reverse()) {
    try {
      const obj = JSON.parse(line);
      if (obj && typeof obj === "object" && obj.type === "result") {
        result = obj;
        break;
      }
    } catch {
      /* not JSON */
    }
  }
  if (!result) throw new RecognizerError("failed", "");
  if (result.is_error === true) {
    throw new RecognizerError("failed", String(result.result ?? result.subtype ?? ""));
  }
  return result;
}

/**
 * The answer to a `--json-schema` request: the structured output, or else the text result parsed
 * as JSON. Null if neither is an object.
 */
export function parseStructured(stdout: string): Record<string, unknown> | null {
  const result = findResult(stdout);
  const structured = result.structured_output;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as Record<string, unknown>;
  if (typeof result.result !== "string") return null;
  let text = result.result.trim();
  // Models sometimes fence the JSON anyway.
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1];
  try {
    const obj = JSON.parse(text);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

/** Pulls the LaTeX out of `claude -p --output-format stream-json` output. */
export function parseOutput(stdout: string): string {
  const result = findResult(stdout);
  let latex: string | null = null;
  const structured = result.structured_output as { latex?: unknown } | undefined;
  if (structured && typeof structured.latex === "string") latex = structured.latex;
  if (latex === null && typeof result.result === "string") {
    // The text result is usually the same JSON again; fall back to plain text.
    try {
      const obj = JSON.parse(result.result);
      latex = typeof obj?.latex === "string" ? obj.latex : result.result;
    } catch {
      latex = result.result;
    }
  }
  const cleaned = cleanLatex(latex ?? "");
  if (!cleaned) throw new RecognizerError("empty");
  return cleaned;
}

/** Maps raw failures to something a person can act on. */
export function explain(error: RecognizerError, stderr: string, status: number): RecognizerError {
  const detail = error.kind === "failed" ? error.message : "";
  const haystack = `${stderr} ${detail}`.toLowerCase();
  if (["not logged in", "/login", "invalid api key", "authentication"].some((s) => haystack.includes(s))) {
    return new RecognizerError("notLoggedIn");
  }
  if (error.kind === "failed" && !error.message) {
    const trimmed = stderr.trim();
    return new RecognizerError("failed", trimmed ? trimmed.slice(-600) : `Claude exited with status ${status}.`);
  }
  return error;
}

async function ask(run: RunClaude, png: string, note: string | null): Promise<string> {
  const reply = await run({ png, note });
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
    return parseOutput(reply.stdout);
  } catch (error) {
    if (error instanceof RecognizerError) throw explain(error, reply.stderr, reply.status);
    throw error;
  }
}

/**
 * Recognizes the math in `png` (base64). If the answer doesn't typeset, Claude gets one chance
 * to rephrase it; if that fails too, the first answer is kept (it shows as fixable source).
 */
export async function recognizeLatex(png: string, run: RunClaude, isValid: (latex: string) => boolean): Promise<string> {
  const first = await ask(run, png, null);
  if (isValid(first)) return first;
  const note =
    `Your previous answer was: ${first}\n` +
    "The renderer (MathJax) could not typeset it. Rewrite the same math using only basic, widely supported commands.";
  try {
    const second = await ask(run, png, note);
    if (isValid(second)) return second;
  } catch {
    /* keep the first answer */
  }
  return first;
}
