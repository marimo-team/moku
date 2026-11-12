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

async function fixture(
  onTestFinished: (cleanup: () => void) => void,
  respond?: NodeHttp.RequestListener,
) {
  const received: {
    method: string | undefined;
    url: string | undefined;
    headers: NodeHttp.IncomingHttpHeaders;
    body: string;
  }[] = [];
  const upstream = NodeHttp.createServer((req, res) => {
    if (respond) return respond(req, res);
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      received.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      res.writeHead(req.headers["if-match"] === '"stale"' ? 412 : 200, {
        "Content-Type": "application/json",
      });
      res.end(JSON.stringify({ received: true }));
    })();
  });
  onTestFinished(() => {
    upstream.closeAllConnections();
    upstream.close();
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string")
    throw new Error("Missing address");
  const hostUrl = `http://127.0.0.1:${upstreamAddress.port}/api/marimo/v1`;
  let origin = "";
  const api = createApi({
    origin: () => origin,
    discover: async function* () {
      yield {
        version: 1,
        name: "local",
        url: hostUrl,
        token: "local-secret",
        process: { pid: 123, started_at: "2026-11-05T12:00:00Z" },
      };
    },
  });
  const server = NodeHttp.createServer(api.handle);
  onTestFinished(() => {
    api.close();
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  origin = `http://127.0.0.1:${address.port}`;
  const session = await fetch(`${origin}/api/session`, {
    method: "POST",
    headers: { Origin: origin, Authorization: `Bearer ${api.launchKey}` },
  });
  const cookie = session.headers.get("set-cookie")!.split(";")[0];
  const headers = { Cookie: cookie, Origin: origin, "Idempotency-Key": "request-1" };
  const hosts: { id: string }[] = await (
    await fetch(`${origin}/api/hosts`, { headers })
  ).json();
  return {
    api,
    origin,
    headers,
    received,
    hostUrl,
    base: `${origin}/api/hosts/${hosts[0].id}`,
  };
}

test("manual connections normalize URLs, replace credentials, and keep secrets server-side", async ({
  onTestFinished,
}) => {
  const { origin, headers, received, hostUrl } = await fixture(onTestFinished);
  const connect = (url: string, token = "manual-secret", requestHeaders = headers) =>
    fetch(`${origin}/api/hosts`, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({ url, token }),
    });
  const first = await connect(`${hostUrl}///`);
  NodeAssert.equal(first.status, 201);
  const summary = await first.json();
  NodeAssert.deepEqual(summary, {
    id: summary.id,
    name: new URL(hostUrl).host,
    url: hostUrl,
    source: "manual",
  });
  const replacement = await connect(hostUrl, "replacement-secret");
  NodeAssert.deepEqual(await replacement.json(), summary);
  const hosts = await (await fetch(`${origin}/api/hosts`, { headers })).json();
  NodeAssert.equal(hosts.length, 2);
  NodeAssert.equal(hosts[1].source, "local");
  NodeAssert.equal(hosts[1].pid, 123);
  NodeAssert.ok(!JSON.stringify(hosts).includes("secret"));
  const response = await fetch(
    `${origin}/api/hosts/${summary.id}/events?cursor=abc&run_id=run-1&target=https://example.com`,
    { headers },
  );
  await response.text();
  NodeAssert.equal(received[0].headers.authorization, "Bearer replacement-secret");
  NodeAssert.equal(received[0].headers.cookie, undefined);
  NodeAssert.equal(received[0].url, "/api/marimo/v1/events?cursor=abc&run_id=run-1");
  NodeAssert.equal((await connect(hostUrl, "")).status, 201);
  await (await fetch(`${origin}/api/hosts/${summary.id}/events`, { headers })).text();
  NodeAssert.equal(received[1].headers.authorization, undefined);
  const missingOrigin = await connect(hostUrl, "secret", { ...headers, Origin: "" });
  NodeAssert.equal(missingOrigin.status, 403);
  for (const invalid of [
    "file:///tmp/notebook",
    "http://user:secret@example.com",
    "https://example.com/?token=secret",
    "https://example.com/#secret",
    "bad url",
  ]) {
    const response = await connect(invalid);
    NodeAssert.equal(response.status, 400);
    NodeAssert.ok(!(await response.text()).includes("secret"));
  }
});

test("editor writes and both interrupt operations preserve protocol preconditions", async ({
  onTestFinished,
}) => {
  const { base, headers, received } = await fixture(onTestFinished);
  const code = "# large source\n".repeat(6000);
  const routes = [
    {
      method: "POST",
      path: "/edits",
      body: {
        changes: [
          { kind: "put_cell", base_etag: null, cell: { id: "a", code }, before: "b" },
        ],
      },
    },
    { method: "POST", path: "/save", body: { decisions: { overwrite: "yes" } } },
    { method: "PUT", path: "/runtime", body: {} },
    {
      method: "POST",
      path: "/runtime/runs",
      body: { cells: [{ id: "a", etag: "v1" }] },
    },
    { method: "DELETE", path: "/runtime/runs/run-1" },
    { method: "POST", path: "/runtime/interrupt" },
    { method: "DELETE", path: "/runtime" },
  ];
  for (const route of routes) {
    const response = await fetch(`${base}/notebooks/n${route.path}`, {
      method: route.method,
      headers: { ...headers, "If-Match": '"document-v1"' },
      body: route.body && JSON.stringify(route.body),
    });
    NodeAssert.equal(response.status, 200, route.path);
    await response.text();
    const request = received.at(-1)!;
    NodeAssert.equal(request.method, route.method);
    NodeAssert.equal(request.url, `/api/marimo/v1/notebooks/n${route.path}`);
    NodeAssert.equal(request.headers["idempotency-key"], "request-1");
    NodeAssert.equal(request.headers.authorization, "Bearer local-secret");
    NodeAssert.equal(
      request.headers["if-match"],
      route.path === "/save" ? '"document-v1"' : undefined,
    );
    NodeAssert.equal(request.headers.cookie, undefined);
  }
  NodeAssert.equal(JSON.parse(received[0].body).changes[0].cell.code, code);
  NodeAssert.equal(JSON.parse(received[0].body).changes[0].before, "b");
  NodeAssert.equal(received[4].body, "");
  NodeAssert.equal(received[5].body, "");
  const conflict = await fetch(`${base}/notebooks/n/save`, {
    method: "POST",
    headers: { ...headers, "If-Match": '"stale"' },
    body: "{}",
  });
  NodeAssert.equal(conflict.status, 412);
  NodeAssert.deepEqual(await conflict.json(), { received: true });
});

test("invalid writes and unavailable hosts fail locally without reaching upstream", async ({
  onTestFinished,
}) => {
  const { base, origin, headers, received } = await fixture(onTestFinished);
  const post = (
    path: string,
    body: string,
    requestHeaders: Record<string, string> = headers,
  ) =>
    fetch(`${base}/notebooks/n${path}`, {
      method: "POST",
      headers: requestHeaders,
      body,
    });
  NodeAssert.equal(
    (
      await post("/edits", "{}", {
        Cookie: headers.Cookie,
        "Idempotency-Key": "request-1",
      })
    ).status,
    403,
  );
  NodeAssert.equal(
    (await post("/edits", "{}", { Cookie: headers.Cookie, Origin: origin })).status,
    400,
  );
  for (const [path, body] of [
    ["/edits", "{}"],
    ["/edits", "{"],
    ["/runtime/runs", '{"cells":[]}'],
    ["/save", '{"decisions":42}'],
  ]) {
    NodeAssert.equal((await post(path, body)).status, 400);
  }
  NodeAssert.equal((await post("/open", "{}")).status, 404);
  NodeAssert.equal((await fetch(`${base}/notebooks/n/save`, { headers })).status, 404);
  const missing = await fetch(`${origin}/api/hosts/${"0".repeat(24)}/events`, {
    headers,
  });
  NodeAssert.equal(missing.status, 404);
  NodeAssert.equal(missing.headers.get("x-momo-error"), "host-unavailable");
  const unauthenticated = await fetch(`${origin}/api/hosts`);
  NodeAssert.equal(unauthenticated.headers.get("x-momo-error"), "session-required");
  NodeAssert.equal(received.length, 0);
});

for (const shutdown of ["browser disconnect", "proxy shutdown"] as const) {
  test(`${shutdown} releases the upstream event stream`, async ({ onTestFinished }) => {
    const disconnected = Promise.withResolvers<void>();
    const { api, base, headers, origin } = await fixture(
      onTestFinished,
      (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(": heartbeat\n\n");
        res.once("close", () => disconnected.resolve());
      },
    );
    const controller = new AbortController();
    const response = await fetch(`${base}/events`, {
      headers,
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    NodeAssert.equal((await reader.read()).done, false);
    if (shutdown === "browser disconnect") controller.abort();
    else api.close();
    await NodeAssert.rejects(reader.read());
    await disconnected.promise;
    if (shutdown === "proxy shutdown") {
      api.close();
      NodeAssert.equal((await fetch(`${origin}/api/hosts`, { headers })).status, 503);
    }
  });
}

test("native outputs keep credentials server-side and force an attach-only stream", async ({
  onTestFinished,
}) => {
  const calls: { url: string; headers: NodeHttp.IncomingHttpHeaders; body: string }[] =
    [];
  const { base, headers } = await fixture(onTestFinished, (req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      calls.push({
        url: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      if (req.url === "/") {
        res.end(
          '<marimo-server-token data-token="server-secret"></marimo-server-token>',
        );
      } else if (req.url?.startsWith("/sse")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end("event: ready\ndata: {}\n\n");
      } else if (req.url?.startsWith("/@file/")) {
        res.writeHead(200, { "Content-Type": "text/javascript" });
        res.end("export default {};");
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"success":true}');
      }
    })();
  });
  const native = base + "/marimo";
  const post = (path: string, body: unknown, supplied: HeadersInit = headers) =>
    fetch(native + path, {
      method: "POST",
      headers: supplied,
      body: JSON.stringify(body),
    });
  NodeAssert.equal((await fetch(native + "/@file/code.js", { headers })).status, 401);
  const authorized = await post("/auth", { token: "native-secret" });
  NodeAssert.deepEqual(await authorized.json(), { success: true });
  NodeAssert.equal(calls[0].headers.authorization, "Bearer native-secret");
  NodeAssert.equal(calls[0].headers.cookie, undefined);
  const stream = await fetch(
    native +
      "/sse?session_id=output-1&file=%2Fproject%2Fn.py&kiosk=false&types=cell&target=https://example.com",
    { headers },
  );
  await stream.text();
  const url = new URL(calls[1].url, "http://upstream");
  NodeAssert.equal(url.pathname, "/sse");
  NodeAssert.equal(url.searchParams.get("kiosk"), "true");
  NodeAssert.equal(url.searchParams.get("types"), "notebook,runtime,marimo");
  NodeAssert.equal(url.searchParams.get("target"), null);
  NodeAssert.equal(calls[1].headers.authorization, "Bearer native-secret");
  NodeAssert.equal(calls[1].headers["last-event-id"], undefined);
  const body = {
    modelId: "model",
    message: { method: "update", state: { x: null }, bufferPaths: [["x"]] },
    buffers: ["AQ=="],
  };
  NodeAssert.equal(
    (
      await post("/api/kernel/set_model_value", body, {
        ...headers,
        "Marimo-Session-Id": "output-1",
      })
    ).status,
    200,
  );
  NodeAssert.deepEqual(JSON.parse(calls[2].body), body);
  NodeAssert.equal(calls[2].headers["marimo-server-token"], "server-secret");
  NodeAssert.equal(calls[2].headers["marimo-session-id"], "output-1");
  NodeAssert.equal(calls[2].headers["idempotency-key"], undefined);
  const asset = await fetch(native + "/@file/code.js", { headers });
  NodeAssert.equal(await asset.text(), "export default {};");
  NodeAssert.equal(asset.headers.get("content-type"), "text/javascript");
  NodeAssert.equal((await post("/api/kernel/set_model_value", body)).status, 400);
  NodeAssert.equal(
    (
      await post(
        "/api/kernel/function_call",
        {},
        { ...headers, "Marimo-Session-Id": "output-1" },
      )
    ).status,
    400,
  );
  NodeAssert.equal((await post("/api/kernel/run", {})).status, 404);
  NodeAssert.equal((await post("/auth", {}, { ...headers, Origin: "" })).status, 403);
  NodeAssert.equal(calls.length, 4);
});

test("closing the proxy releases native output streams", async ({ onTestFinished }) => {
  const disconnected = Promise.withResolvers<void>();
  const { api, base, headers } = await fixture(onTestFinished, (req, res) => {
    if (req.url === "/") {
      res.end('<marimo-server-token data-token="skew"></marimo-server-token>');
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": heartbeat\n\n");
    res.once("close", disconnected.resolve);
  });
  const auth = await fetch(base + "/marimo/auth", {
    method: "POST",
    headers,
    body: "{}",
  });
  NodeAssert.equal(auth.status, 200);
  const response = await fetch(
    base + "/marimo/sse?session_id=output-1&file=%2Fproject%2Fn.py",
    { headers },
  );
  const reader = response.body!.getReader();
  NodeAssert.equal((await reader.read()).done, false);
  api.close();
  await NodeAssert.rejects(reader.read());
  await disconnected.promise;
});
