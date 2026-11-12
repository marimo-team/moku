import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import * as NodeHttp from "node:http";
import { createApi } from "../src/server.ts";
import type { HostRecordOutput } from "@marimo-team/client/protocol";

test("local authentication protects discovery and forwards authenticated streams without exposing host tokens", async ({
  onTestFinished,
}) => {
  let upstreamHeaders: NodeHttp.IncomingHttpHeaders = {};
  let upstreamUrl = "";
  const upstream = NodeHttp.createServer((req, res) => {
    upstreamHeaders = req.headers;
    upstreamUrl = req.url ?? "";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end("event: ready\nid: cursor-1\ndata: {}\n\n");
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string")
    throw new Error("Missing address");
  const record: HostRecordOutput = {
    version: 1,
    name: "test host",
    url: `http://127.0.0.1:${upstreamAddress.port}/api/marimo/v1`,
    token: "host-secret-never-sent-to-browser",
    process: { pid: 123, started_at: "2026-11-05T12:00:00Z" },
  };
  let origin = "";
  const api = createApi({
    origin: () => origin,
    clientName: "fixture",
    discover: async function* () {
      yield record;
    },
  });
  const server = NodeHttp.createServer(api.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  origin = `http://127.0.0.1:${address.port}`;
  NodeAssert.equal((await fetch(`${origin}/api/hosts`)).status, 401);
  NodeAssert.equal(
    (
      await fetch(`${origin}/api/session`, {
        method: "POST",
        headers: {
          Origin: "https://example.com",
          Authorization: `Bearer ${api.launchKey}`,
        },
      })
    ).status,
    403,
  );
  NodeAssert.equal(
    (
      await fetch(`${origin}/api/session`, {
        method: "POST",
        headers: { Origin: origin, Authorization: "Bearer wrong" },
      })
    ).status,
    401,
  );
  const session = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { Origin: origin, Authorization: `Bearer ${api.launchKey}` },
  });
  NodeAssert.equal(session.status, 200);
  const cookieHeader = session.headers.get("set-cookie")!;
  NodeAssert.match(cookieHeader, /HttpOnly/);
  NodeAssert.match(cookieHeader, /SameSite=Strict/);
  const cookie = cookieHeader.split(";")[0];
  const response = await fetch(`${origin}/api/hosts`, {
    headers: { Cookie: cookie },
  });
  const raw = await response.text();
  NodeAssert.ok(!raw.includes(record.token));
  NodeAssert.ok(!raw.includes("token"));
  const hosts: { id: string }[] = JSON.parse(raw);
  const base = `${origin}/api/hosts/${hosts[0].id}`;
  const stream = await fetch(
    `${base}/events?types=notebook&target=http://example.com`,
    {
      headers: { Cookie: cookie, "Last-Event-ID": "resume-here" },
    },
  );
  NodeAssert.equal(stream.status, 200);
  NodeAssert.match(await stream.text(), /cursor-1/);
  NodeAssert.equal(upstreamHeaders.authorization, `Bearer ${record.token}`);
  NodeAssert.equal(upstreamHeaders["last-event-id"], "resume-here");
  NodeAssert.equal(upstreamUrl, "/api/marimo/v1/events?types=notebook");
  NodeAssert.equal(upstreamHeaders.cookie, undefined);
  NodeAssert.equal(upstreamHeaders["marimo-attachment-name"], "fixture");
  NodeAssert.equal(
    (
      await fetch(`${base}/notebooks/n/runtime/runs`, {
        method: "POST",
        headers: { Cookie: cookie },
        body: "{}",
      })
    ).status,
    403,
  );
  NodeAssert.equal(
    (
      await fetch(`${base}/notebooks/n`, {
        method: "DELETE",
        headers: { Cookie: cookie, Origin: origin },
      })
    ).status,
    404,
  );
  const rebindingStatus = await new Promise<number | undefined>((resolve, reject) => {
    NodeHttp.get(
      `${origin}/api/hosts`,
      { headers: { Cookie: cookie, Host: "attacker.example" } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    ).on("error", reject);
  });
  NodeAssert.equal(rebindingStatus, 403);
  NodeAssert.equal(
    (
      await fetch(`${origin}/api/hosts`, {
        headers: { Cookie: cookie, Origin: "https://example.com" },
      })
    ).status,
    403,
  );
});
