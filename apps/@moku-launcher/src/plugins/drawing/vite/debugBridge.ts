/**
 * The Drawing view's Debug route.
 *
 * `POST /__sketcher/debug {path, note, errors}` starts a Claude agent that works inside the
 * notebook's running kernel with [marimo-pair](https://github.com/marimo-team/marimo-pair), and
 * streams what it does back as JSON lines.
 *
 * Unlike Ask, this agent has tools, but only two. Bash may only run marimo-pair's execute-code
 * script against this notebook's own session, and Read may only open marimo-pair's docs and the
 * notebook folder. `--permission-mode dontAsk` refuses everything else without asking.
 * marimo-pair is found at `$SKETCHER_MARIMO_PAIR`, else in `~/.claude/skills` or
 * `~/.agents/skills`.
 *
 * @module
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs";
import type * as NodeHttp from "node:http";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { findClaude, sameOrigin } from "sketcher/vite";

/** The route's path. */
const DEBUG_ROUTE = "/__sketcher/debug";

const TIMEOUT_SECONDS = 600;
const instructions = NodeFs.readFileSync(
  new URL("./debug.md", import.meta.url),
  "utf8",
);

/** What the board sends. */
interface DebugBody {
  /** The notebook's path, as moku knows it. */
  path: string;
  note: string;
  errors: { cell: string; error: string }[];
  /** Whether the board started this on its own, for a cell that failed. */
  auto: boolean;
}

/** One line of the response. */
type DebugEvent =
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; text: string }
  | { type: "done"; ok: boolean; summary: string; seconds: number };

/** marimo-pair's folder, if it's installed. */
function findMarimoPair(): string | null {
  const candidates = [
    process.env.SKETCHER_MARIMO_PAIR,
    NodePath.join(NodeOs.homedir(), ".claude", "skills", "marimo-pair"),
    NodePath.join(NodeOs.homedir(), ".agents", "skills", "marimo-pair"),
  ];
  for (const dir of candidates) {
    if (dir && NodeFs.existsSync(NodePath.join(dir, "scripts", "execute-code.sh")))
      return dir;
  }
  return null;
}

/** The running marimo server and session that have `path` open (moku runs them with --no-token). */
async function findSession(
  path: string,
): Promise<{ port: number; session: string; file: string } | null> {
  const dir = NodePath.join(
    process.env.XDG_STATE_HOME ?? NodePath.join(NodeOs.homedir(), ".local", "state"),
    "marimo",
    "servers",
  );
  let entries: string[] = [];
  try {
    entries = NodeFs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const entry of entries) {
    let server: { host?: string; port?: number; base_url?: string; pid?: number };
    try {
      server = JSON.parse(NodeFs.readFileSync(NodePath.join(dir, entry), "utf8"));
      if (typeof server.pid === "number") process.kill(server.pid, 0);
    } catch {
      continue;
    }
    if (server.host !== "127.0.0.1" && server.host !== "localhost") continue;
    try {
      const response = await fetch(
        `http://${server.host}:${server.port}${server.base_url ?? ""}/api/sessions`,
        {
          signal: AbortSignal.timeout(2000),
        },
      );
      const sessions = (await response.json()) as Record<
        string,
        { path?: string; filename?: string }
      >;
      for (const [session, info] of Object.entries(sessions)) {
        const file = info.path ?? info.filename ?? "";
        if (file === path || file.endsWith(`/${path.replace(/^\.?\//, "")}`)) {
          return { port: server.port!, session, file };
        }
      }
    } catch {
      // Not answering: try the next one.
    }
  }
  return null;
}

/** The message the agent starts from. */
function request({ note, errors, auto }: DebugBody): string {
  const lines = [
    auto
      ? "The board noticed failing cells and asked you to fix them; nobody is waiting on a reply, so just fix it."
      : `The person pressed Debug${note.trim() ? ` and wrote: ${note.trim()}` : ", without saying what's wrong: look for problems."}`,
  ];
  if (errors.length > 0) {
    lines.push("", "Cells failing right now:");
    for (const e of errors.slice(0, 12))
      lines.push(`- \`${e.cell}\`: ${e.error.slice(0, 1500)}`);
  }
  return lines.join("\n");
}

/** A short line about a tool call, for the board's progress list. */
function describeTool(name: string, input: Record<string, unknown>): string {
  if (typeof input.description === "string" && input.description)
    return input.description;
  if (name === "Read" && typeof input.file_path === "string")
    return `Reading ${input.file_path.split("/").at(-1)}`;
  if (name === "Bash" && typeof input.command === "string") {
    const code = input.command
      .split("\n")
      .slice(1)
      .find((l) => l.trim() && !l.startsWith("import ") && l.trim() !== "EOF");
    return code ? `Running ${code.trim().slice(0, 80)}` : "Running code in the kernel";
  }
  return name;
}

interface Server {
  middlewares: {
    use(
      path: string,
      handler: (req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) => void,
    ): void;
  };
}

/** Adds {@link DEBUG_ROUTE} to the dev server. `moku` is the repository root, for the logs. */
export function addDebugRoute(server: Server, moku: () => string): void {
  server.middlewares.use(DEBUG_ROUTE, (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end();
      return;
    }
    if (!sameOrigin(req)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => void run(raw, req, res, moku()));
  });
}

async function run(
  raw: string,
  req: NodeHttp.IncomingMessage,
  res: NodeHttp.ServerResponse,
  moku: string,
): Promise<void> {
  res.setHeader("Content-Type", "application/x-ndjson");
  const started = Date.now();
  const send = (event: DebugEvent) => {
    if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
  };
  const finish = (ok: boolean, summary: string) => {
    send({ type: "done", ok, summary, seconds: (Date.now() - started) / 1000 });
    res.end();
  };

  let body: DebugBody;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.path !== "string" || !parsed.path.endsWith(".py"))
      throw new Error("bad path");
    body = {
      path: parsed.path,
      note: typeof parsed.note === "string" ? parsed.note.slice(0, 4000) : "",
      errors: Array.isArray(parsed.errors)
        ? parsed.errors.filter(
            (e: unknown): e is { cell: string; error: string } =>
              !!e &&
              typeof (e as { cell: unknown }).cell === "string" &&
              typeof (e as { error: unknown }).error === "string",
          )
        : [],
      auto: parsed.auto === true,
    };
  } catch {
    finish(false, "Bad request.");
    return;
  }
  const claude = findClaude();
  if (!claude)
    return finish(
      false,
      "Couldn't find the claude command. Install Claude Code and log in.",
    );
  const pair = findMarimoPair();
  if (!pair) {
    return finish(
      false,
      "Debug needs the marimo-pair skill (https://github.com/marimo-team/marimo-pair) in ~/.claude/skills, or SKETCHER_MARIMO_PAIR pointing at it.",
    );
  }
  send({ type: "status", text: "Finding the notebook's kernel…" });
  const session = await findSession(body.path);
  if (!session)
    return finish(
      false,
      `Couldn't find a running marimo session for ${body.path}. Is the kernel running?`,
    );

  const execute = NodePath.join(pair, "scripts", "execute-code.sh");
  const system = instructions
    .replaceAll("{{NOTEBOOK}}", session.file)
    .replaceAll("{{EXECUTE}}", execute)
    .replaceAll("{{PORT}}", String(session.port))
    .replaceAll("{{SESSION}}", session.session)
    .replaceAll("{{SKILL}}", pair);
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    "Bash,Read",
    "--allowedTools",
    `Bash(bash ${execute} --port ${session.port} --session ${session.session} *)`,
    `Read(/${pair}/**)`,
    `Read(/${NodePath.dirname(session.file)}/**)`,
    "--permission-mode",
    "dontAsk",
    "--append-system-prompt",
    system,
    "--no-session-persistence",
    "--strict-mcp-config",
    "--disable-slash-commands",
  ];
  if (process.env.SKETCHER_ASK_MODEL)
    args.push("--model", process.env.SKETCHER_ASK_MODEL);

  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const cwd = NodeFs.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "sketcher-debug-"));
  const text = request(body);
  const transcript: string[] = [];
  let child: NodeChildProcess.ChildProcess;
  try {
    child = NodeChildProcess.spawn(claude, args, { cwd, env });
  } catch (error) {
    NodeFs.rmSync(cwd, { recursive: true, force: true });
    return finish(false, `Couldn't start Claude: ${String(error)}`);
  }
  send({
    type: "status",
    text: body.auto
      ? "Claude is looking at the failing cells…"
      : "Claude is looking into it…",
  });
  // Stop the agent when the board cancels (or the page goes away).
  res.on("close", () => child.kill());
  const timer = setTimeout(() => child.kill(), TIMEOUT_SECONDS * 1000);

  let buffer = "",
    stderr = "",
    summary = "",
    ok = false;
  child.stdout!.on("data", (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      let event: {
        type?: string;
        message?: { content?: unknown[] };
        result?: unknown;
        is_error?: boolean;
        subtype?: string;
      };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "assistant") {
        for (const block of event.message?.content ?? []) {
          const b = block as {
            type: string;
            text?: string;
            name?: string;
            input?: Record<string, unknown>;
          };
          if (b.type === "text" && b.text?.trim()) {
            send({ type: "text", text: b.text.trim() });
            transcript.push(b.text.trim());
          } else if (b.type === "tool_use" && b.name) {
            send({ type: "tool", text: describeTool(b.name, b.input ?? {}) });
            transcript.push(
              `\`\`\`\n${b.name}: ${typeof b.input?.command === "string" ? b.input.command : JSON.stringify(b.input)}\n\`\`\``,
            );
          }
        }
      } else if (event.type === "result") {
        ok = !event.is_error;
        summary =
          typeof event.result === "string"
            ? event.result.trim()
            : String(event.subtype ?? "");
      }
    }
  });
  child.stderr!.on("data", (d) => (stderr += d));
  child.on("error", (error) => {
    clearTimeout(timer);
    finish(false, `Couldn't run Claude: ${error.message}`);
  });
  child.on("close", (status) => {
    clearTimeout(timer);
    NodeFs.rmSync(cwd, { recursive: true, force: true });
    const seconds = (Date.now() - started) / 1000;
    if (!summary)
      summary =
        seconds >= TIMEOUT_SECONDS
          ? "Claude ran out of time."
          : stderr.trim().split("\n").at(-1) || `Claude stopped (exit ${status}).`;
    try {
      log(NodePath.join(moku, "ask-logs"), {
        text,
        system,
        transcript,
        summary,
        ok,
        seconds,
      });
    } catch (error) {
      console.warn(`[sketcher] couldn't write the debug log: ${String(error)}`);
    }
    finish(ok, summary);
  });
  child.stdin!.end(
    `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } })}\n`,
  );
}

/** Prints one line about a debug run and writes the whole exchange next to the ask logs. */
function log(
  dir: string,
  {
    text,
    system,
    transcript,
    summary,
    ok,
    seconds,
  }: {
    text: string;
    system: string;
    transcript: string[];
    summary: string;
    ok: boolean;
    seconds: number;
  },
): void {
  NodeFs.mkdirSync(dir, { recursive: true });
  NodeFs.writeFileSync(NodePath.join(dir, ".gitignore"), "*\n");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = NodePath.join(dir, `${stamp}-debug.md`);
  NodeFs.writeFileSync(
    file,
    [
      `# Debug: ${text.split("\n")[0]}`,
      "",
      `${new Date().toLocaleString()} · ${seconds.toFixed(1)} s · ${ok ? "done" : "failed"}`,
      "",
      "## Summary",
      "",
      summary,
      "",
      "## What Claude did",
      "",
      ...transcript,
      "",
      "## What Claude was told",
      "",
      "```text",
      text,
      "```",
      "",
      "<details><summary>System prompt (appended)</summary>",
      "",
      "```text",
      system,
      "```",
      "",
      "</details>",
      "",
    ].join("\n"),
  );
  console.log(
    `[sketcher] ✦ debug → ${ok ? "done" : "failed"} (${seconds.toFixed(1)} s) · ${file}`,
  );
}
