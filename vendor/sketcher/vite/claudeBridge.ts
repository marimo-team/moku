// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/vite/claudeBridge.ts. Edit it there and rerun scripts/sketcher.ts.
// Dev-server stand-in for the Python kernel: POST /api/claude {png, note} runs `claude -p` with the
// same fixed arguments as python/src/sketcher/claude.py and returns its raw output.
//
// `findClaude`, `spawnClaude` and `jsonRoute` are shared with other dev-server bridges (the moku
// drawing notebook's lives in ../../moku/vite), so every bridge finds and runs Claude the same way.
import { spawn } from "node:child_process";
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { Plugin } from "vite";

const config = JSON.parse(
  readFileSync(new URL("./claude.json", import.meta.url), "utf8"),
) as { systemPrompt: string; schema: string; prompt: string; timeoutSeconds: number };

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `$SKETCHER_CLAUDE`, else `claude` on the PATH or in the usual install places. */
export function findClaude(): string | null {
  const explicit = process.env.SKETCHER_CLAUDE;
  if (explicit) return executable(explicit) ? explicit : null;
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local", "bin"),
    join(homedir(), ".claude", "local"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  for (const dir of dirs) {
    if (dir && executable(join(dir, "claude"))) return join(dir, "claude");
  }
  return null;
}

export type Reply = { stdout: string; stderr: string; status: number } | { error: string; message?: string };

/** One user message for `--input-format stream-json`. */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } };

/** Flags every bridge passes: one non-interactive turn, no tools, no MCP, nothing saved. */
export function claudeArgs({ schema, systemPrompt, model }: { schema: string; systemPrompt: string; model?: string }): string[] {
  const args = [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--tools", "", "--json-schema", schema, "--system-prompt", systemPrompt,
    "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands",
  ];
  if (model) args.push("--model", model);
  return args;
}

/** Runs `claude` once in an empty temporary directory and hands back its raw output. */
export function spawnClaude(
  { args, content, timeoutSeconds }: { args: string[]; content: ContentBlock[]; timeoutSeconds: number },
): Promise<Reply> {
  const claude = findClaude();
  if (!claude) return Promise.resolve({ error: "not_found" });
  const env = { ...process.env };
  // Running inside Claude Code would otherwise make the child think it's nested.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const cwd = mkdtempSync(join(tmpdir(), "sketcher-"));
  const message = { type: "user", message: { role: "user", content } };
  return new Promise((resolve) => {
    const child = spawn(claude, args, { cwd, env });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutSeconds * 1000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ error: "failed", message: String(e) });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      rmSync(cwd, { recursive: true, force: true });
      resolve(timedOut ? { error: "timeout" } : { stdout, stderr, status: status ?? -1 });
    });
    child.stdin.end(`${JSON.stringify(message)}\n`);
  });
}

/**
 * Whether a request comes from a page on this server. Running Claude costs the person's usage,
 * so other sites mustn't be able to trigger it: they can't send a JSON content type without a
 * CORS preflight (which the dev server refuses them), and browsers always say where they're from.
 */
export function sameOrigin(req: IncomingMessage): boolean {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** A POST-only, same-origin middleware that reads a JSON body and answers with JSON. */
export function jsonRoute(handle: (body: Record<string, unknown>) => Promise<unknown>) {
  return (req: IncomingMessage, res: ServerResponse) => {
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
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let reply: unknown;
      try {
        const parsed = JSON.parse(body);
        reply = parsed && typeof parsed === "object" ? await handle(parsed) : { error: "failed", message: "Bad request" };
      } catch (error) {
        reply = { error: "failed", message: String(error) };
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(reply));
    });
  };
}

function runClaude(png: string, note: string | null): Promise<Reply> {
  return spawnClaude({
    args: claudeArgs({ schema: config.schema, systemPrompt: config.systemPrompt, model: process.env.SKETCHER_LATEX_MODEL }),
    content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
      { type: "text", text: config.prompt + (note ? `\n\n${note}` : "") },
    ],
    timeoutSeconds: config.timeoutSeconds,
  });
}

export function claudeBridge(): Plugin {
  return {
    name: "sketcher-claude-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        "/api/claude",
        jsonRoute(({ png, note }) =>
          typeof png === "string"
            ? runClaude(png, typeof note === "string" ? note : null)
            : Promise.resolve({ error: "failed", message: "Bad request" }),
        ),
      );
    },
  };
}
