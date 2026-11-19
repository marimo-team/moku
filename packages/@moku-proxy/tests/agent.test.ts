import * as NodeAssert from "node:assert/strict";
import * as NodeHttp from "node:http";
import * as NodeUrl from "node:url";
import * as Vitest from "vite-plus/test";
import { Schema } from "effect";
import type { HostRecordOutput } from "@marimo-team/client/protocol";
import * as Agent from "../src/Agent.ts";
import { createApi } from "../src/server.ts";

const fixture = NodeUrl.fileURLToPath(new URL("./fixtures/agent.mjs", import.meta.url));

/** Reads server-sent events until `until` matches one. */
async function* events(response: Response) {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      if (frame.startsWith("data: "))
        yield Schema.decodeUnknownSync(Agent.Event)(JSON.parse(frame.slice(6)));
    }
  }
}

Vitest.test(
  "agent dialogs stream condensed turns, relay permission answers, and receive notebook tools",
  async ({ onTestFinished }) => {
    const record: HostRecordOutput = {
      version: 1,
      name: "managed",
      url: "http://127.0.0.1:2718/api/marimo/v1",
      token: "host-token",
      process: { pid: 1, started_at: "2026-11-05T12:00:00Z" },
    };
    let origin = "";
    const api = createApi({
      origin: () => origin,
      server: { host: record },
      discover: async function* () {},
      agent: { command: process.execPath, args: [fixture], cwd: process.cwd() },
    });
    onTestFinished(() => api.close());
    const server = NodeHttp.createServer(api.handle);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => {
      server.closeAllConnections();
      server.close();
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    origin = `http://127.0.0.1:${address.port}`;
    const session = await fetch(`${origin}/api/session`, {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${api.launchKey}` },
    });
    const cookie = session.headers.get("set-cookie")!.split(";")[0];
    const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
      fetch(`${origin}/api/agent${path}`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: origin, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

    NodeAssert.equal(
      (await post("/sessions", undefined, { Origin: "https://example.com" })).status,
      403,
    );
    const created = await post("/sessions", { model: "fixture/large" });
    NodeAssert.equal(created.status, 201);
    const { sessionId, agent, notebookTools, models } = Schema.decodeUnknownSync(
      Agent.Created,
    )(await created.json());
    NodeAssert.equal(agent, "fixture-agent");
    NodeAssert.equal(notebookTools, true);
    NodeAssert.deepEqual(models, {
      current: "fixture/large",
      options: [
        { value: "fixture/small", name: "Small" },
        { value: "fixture/large", name: "Large" },
      ],
    });
    const base = `/sessions/${encodeURIComponent(sessionId)}`;

    const selected = await post(`${base}/model`, { value: "fixture/small" });
    NodeAssert.equal(selected.status, 200);
    NodeAssert.equal(
      Schema.decodeUnknownSync(Agent.Models)(await selected.json()).current,
      "fixture/small",
    );

    const stream = await fetch(`${origin}/api/agent${base}/events`, {
      headers: { Cookie: cookie },
    });
    NodeAssert.equal(stream.status, 200);
    NodeAssert.equal((await post(`${base}/prompt`, { text: "hello" })).status, 202);
    NodeAssert.equal((await post(`${base}/prompt`, { text: "again" })).status, 409);

    // Plain loops keep one reader across turns, where `for await` would close it on break.
    const received = events(stream);
    let text = "";
    const seen: Agent.Event["type"][] = [];
    for (let next = await received.next(); !next.done; next = await received.next()) {
      const event = next.value;
      seen.push(event.type);
      if (event.type === "text") text += event.text;
      if (event.type === "tool") NodeAssert.equal(event.title, "Run cell");
      if (event.type === "permission") {
        NodeAssert.deepEqual(
          event.options.map((option) => option.id),
          ["allow"],
        );
        NodeAssert.equal(
          (await post(`${base}/permissions/${event.id}`, { optionId: "allow" })).status,
          200,
        );
      }
      if (event.type === "stop") {
        NodeAssert.equal(event.reason, "end_turn");
        break;
      }
    }
    NodeAssert.deepEqual(
      [...new Set(seen)],
      ["text", "tool", "permission", "permission-resolved", "stop"],
    );
    NodeAssert.equal(
      text,
      "echo hello; mcp http://127.0.0.1:2718/mcp/server; permission allow",
    );
    NodeAssert.equal((await post(`${base}/prompt`, { text: "fail" })).status, 202);
    for (let next = await received.next(); !next.done; next = await received.next()) {
      const event = next.value;
      if (event.type !== "error") continue;
      NodeAssert.match(event.message, /Missing bearer authentication/);
      NodeAssert.match(event.message, /fixture\/small/);
      break;
    }
    NodeAssert.equal(
      (await post("/sessions/unknown/prompt", { text: "x" })).status,
      410,
    );
  },
  20_000,
);
