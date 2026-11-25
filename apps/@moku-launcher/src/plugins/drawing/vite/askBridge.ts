/**
 * The Drawing view's dev-server routes.
 *
 * `POST /__sketcher/ask {png, context, text, mode}` runs `claude -p` with fixed arguments from
 * `ask.json` and returns its raw output. `mode` picks the instructions: "cell" (the default)
 * turns a sketch into a cell, and "connect" wires two cells together. The browser builds the
 * text and parses the answer (see `../ask.ts`). The same plugin installs the Debug route from
 * `debugBridge.ts`.
 *
 * Every ask is logged as one line in the terminal, and the whole exchange (what Claude was told,
 * the pictures, and its answer) is written to `ask-logs/` at the repository root, which ignores
 * itself in git.
 *
 * @module
 */
import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import { type Reply, claudeArgs, jsonRoute, spawnClaude } from "sketcher/vite";
import { addDebugRoute } from "./debugBridge.ts";

const config = JSON.parse(
  NodeFs.readFileSync(new URL("./ask.json", import.meta.url), "utf8"),
) as {
  systemPrompt: string;
  schema: string;
  timeoutSeconds: number;
  connect: { systemPrompt: string; schema: string };
};

/** The instructions for each mode. Nothing else from the request reaches Claude's arguments. */
const MODES = {
  cell: { systemPrompt: config.systemPrompt, schema: config.schema },
  connect: config.connect,
} as const;
type Mode = keyof typeof MODES;

/** The route's path. moku's proxy owns everything under `/api/`. */
const ASK_ROUTE = "/__sketcher/ask";

interface Server {
  middlewares: { use(path: string, handler: ReturnType<typeof jsonRoute>): void };
}

/**
 * A Vite plugin, for the dev server only, that adds {@link ASK_ROUTE} and the Debug route.
 *
 * Logs go to `ask-logs/` two levels above the Vite root, which is the repository root for the
 * launcher.
 */
export function drawing() {
  let moku = process.cwd();
  return {
    name: "moku-drawing",
    apply: "serve" as const,
    configResolved(config: { root: string }) {
      moku = NodePath.resolve(config.root, "../..");
    },
    configureServer(server: Server) {
      addDebugRoute(server, () => moku);
      server.middlewares.use(
        ASK_ROUTE,
        jsonRoute(async ({ png, context, text, mode = "cell" }) => {
          if (
            typeof png !== "string" ||
            typeof context !== "string" ||
            typeof text !== "string" ||
            typeof mode !== "string" ||
            !Object.hasOwn(MODES, mode)
          ) {
            return { error: "failed", message: "Bad request" };
          }
          const { schema, systemPrompt } = MODES[mode as Mode];
          const started = Date.now();
          const reply = await spawnClaude({
            args: claudeArgs({
              schema,
              systemPrompt,
              model: process.env.SKETCHER_ASK_MODEL,
            }),
            content:
              mode === "connect"
                ? [
                    {
                      type: "text",
                      text: "The whole board, the two cards being connected outlined in dashed blue:",
                    },
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: "image/png",
                        data: context,
                      },
                    },
                    { type: "text", text },
                  ]
                : [
                    { type: "text", text: "The selection (what to replace):" },
                    {
                      type: "image",
                      source: { type: "base64", media_type: "image/png", data: png },
                    },
                    {
                      type: "text",
                      text: "The whole board, the selection outlined in dashed blue:",
                    },
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: "image/png",
                        data: context,
                      },
                    },
                    { type: "text", text },
                  ],
            timeoutSeconds: config.timeoutSeconds,
          });
          try {
            log(NodePath.join(moku, "ask-logs"), {
              png,
              context,
              text,
              reply,
              seconds: (Date.now() - started) / 1000,
              mode,
            });
          } catch (error) {
            console.warn(`[sketcher] couldn't write the ask log: ${String(error)}`);
          }
          return reply;
        }),
      );
    },
  };
}

/** The `result` event of `claude -p --output-format stream-json`, if there is one. */
function result(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.split("\n").reverse()) {
    try {
      const event = JSON.parse(line);
      if (event?.type === "result") return event;
    } catch {
      // Not JSON.
    }
  }
  return null;
}

/** Prints one line about an ask and writes the whole exchange next to its picture. */
function log(
  dir: string,
  {
    png,
    context,
    text,
    reply,
    seconds,
    mode,
  }: {
    png: string;
    context: string;
    text: string;
    reply: Reply;
    seconds: number;
    mode: string;
  },
): void {
  NodeFs.mkdirSync(dir, { recursive: true });
  // Keep the logs out of git and out of the repository's format check.
  NodeFs.writeFileSync(NodePath.join(dir, ".gitignore"), "*\n");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = NodePath.join(dir, `${stamp}.md`);
  NodeFs.writeFileSync(NodePath.join(dir, `${stamp}.png`), Buffer.from(png, "base64"));
  NodeFs.writeFileSync(
    NodePath.join(dir, `${stamp}-board.png`),
    Buffer.from(context, "base64"),
  );

  const prompt = /^Request: (.*)$/m.exec(text)?.[1] ?? "(no request)";
  const retry = text.includes("Your previous answer had a problem") ? " (retry)" : "";
  const event = "error" in reply ? null : result(reply.stdout);
  const answer = event?.structured_output as Record<string, unknown> | undefined;
  const outcome =
    "error" in reply
      ? `failed: ${reply.error}${reply.message ? ` (${reply.message})` : ""}`
      : event?.is_error
        ? `failed: ${String(event.result ?? event.subtype)}`
        : answer
          ? mode === "connect"
            ? `connected (${String(answer.label) || "no label"}, ${Array.isArray(answer.helpers) ? answer.helpers.length : 0} helper cells)`
            : `${answer.action === "edit" ? "edited" : "wrote"} cell ${String(answer.name)}`
          : `no answer (exit ${reply.status})`;

  const body = [
    `# ${mode === "connect" ? "Connect" : "Ask"}${retry}: ${prompt}`,
    "",
    `${new Date().toLocaleString()} · ${seconds.toFixed(1)} s · ${outcome}`,
    "",
    `What Claude saw: ![selection](${stamp}.png) and the board around it: ![board](${stamp}-board.png)`,
    "",
    "## Claude's answer",
    "",
    answer ? "```json\n" + JSON.stringify(answer, null, 2) + "\n```" : "(none)",
    ...(answer && typeof answer.code === "string"
      ? ["", "```python", answer.code, "```"]
      : []),
    ...(answer && typeof answer.sink_code === "string"
      ? ["", "```python", answer.sink_code, "```"]
      : []),
    "",
    "## What Claude was told",
    "",
    "The system prompt is in the Drawing plugin's vite/ask.json. The message, with the picture:",
    "",
    "```text",
    text,
    "```",
    ...("error" in reply
      ? []
      : reply.stderr.trim()
        ? ["", "## stderr", "", "```text", reply.stderr.trim().slice(-4000), "```"]
        : []),
    "",
  ];
  NodeFs.writeFileSync(file, body.join("\n"));
  console.log(
    `[sketcher] ✦ "${prompt}"${retry} → ${outcome} (${seconds.toFixed(1)} s) · ${file}`,
  );
}
