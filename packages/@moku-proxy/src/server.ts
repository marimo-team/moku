/**
 * Authenticated local routes for marimo host discovery, notebook commands, and events.
 *
 * @module
 */
import * as NodeCrypto from "node:crypto";
import * as NodeBuffer from "node:buffer";
import type * as NodeHttp from "node:http";
import * as NodeStream from "node:stream";
import { discoverHosts } from "@marimo-team/client/node";
import { json, readBody } from "./internal/http.ts";
import type { ManagedServer } from "./internal/managed.ts";
import { createNative } from "./internal/native.ts";
import * as Protocol from "@marimo-team/client/protocol";

/**
 * Public connection details for a host; authentication tokens stay on the server.
 */
export interface HostSummary {
  id: string;
  name: string;
  url: string;
  source: "local" | "manual";
  pid?: number;
}

type Connection = { summary: HostSummary; token: string };

interface Options {
  clientName?: string;
  server?: Pick<ManagedServer, "host">;
  origin: () => string;
  discover?: () => AsyncIterable<Protocol.HostRecordOutput>;
}

function matches(actual: string | undefined, expected: string) {
  const value = NodeBuffer.Buffer.from(actual ?? "");
  const target = NodeBuffer.Buffer.from(expected);
  return value.length === target.length && NodeCrypto.timingSafeEqual(value, target);
}

function normalizeHostUrl(input: string) {
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an HTTP or HTTPS API URL without credentials, query, or fragment.",
    );
  return url.href.replace(/\/+$/, "");
}

const hostId = (value: string) =>
  NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 24);

/**
 * Creates an authenticated proxy with a Node HTTP request handler.
 *
 * `origin` must return the server's current origin for request validation.
 * Use `launchKey` to establish a browser session through `/api/session`.
 * Call `close()` on shutdown to abort upstream requests and discard manual
 * connections. Host credentials remain on the server.
 */
export function createApi({
  origin,
  discover = discoverHosts,
  clientName = "moku",
  server,
}: Options) {
  const launchKey = NodeCrypto.randomBytes(32).toString("hex");
  const sessionKey = NodeCrypto.randomBytes(32).toString("hex");
  const cookieName = `moku_${NodeCrypto.randomBytes(8).toString("hex")}`;
  const manual = new Map<string, Connection>();
  const requests = new Map<AbortController, NodeHttp.ServerResponse>();
  const native = createNative(requests, clientName);
  let closed = false;

  async function connections() {
    const found = new Map(manual);
    const add = (host: Protocol.HostRecordOutput) => {
      const id = hostId(`${host.url}:${host.process.pid}:${host.process.started_at}`);
      found.set(id, {
        summary: {
          id,
          name: host.name,
          url: host.url,
          source: "local",
          pid: host.process.pid,
        },
        token: host.token,
      });
    };
    if (server?.host) add(server.host);
    for await (const host of discover()) add(host);
    return found;
  }

  async function handle(req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) {
    if (closed) return json(res, 503, { error: "The local proxy is shutting down." });
    const expected = origin();
    if (
      req.headers.host !== new URL(expected).host ||
      (req.headers.origin !== undefined && req.headers.origin !== expected) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      return json(res, 403, {
        error: "Open the local launch link printed in your terminal.",
      });
    }
    const url = new URL(req.url ?? "/", expected);
    if (url.pathname === "/api/session" && req.method === "POST") {
      if (
        req.headers.origin !== expected ||
        !matches(req.headers.authorization, `Bearer ${launchKey}`)
      ) {
        return json(res, 401, {
          code: "session-required",
          error:
            "This launch link is invalid. Use the link printed by the running server.",
        });
      }
      res.setHeader(
        "Set-Cookie",
        `${cookieName}=${sessionKey}; HttpOnly; SameSite=Strict; Path=/`,
      );
      return json(res, 200, { authenticated: true });
    }
    const cookie = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!matches(cookie, sessionKey)) {
      return json(res, 401, {
        code: "session-required",
        error: "Open the authenticated launch link from your terminal.",
      });
    }
    if (url.pathname === "/api/session" && req.method === "GET") {
      return json(res, 200, { authenticated: true });
    }
    if (url.pathname === "/api/hosts" && req.method === "GET") {
      return json(
        res,
        200,
        [...(await connections()).values()].map((host) => host.summary),
      );
    }
    if (url.pathname === "/api/hosts" && req.method === "POST") {
      if (req.headers.origin !== expected) {
        return json(res, 403, { error: "Connect from the local app." });
      }
      try {
        const input = await readBody(req);
        if (
          typeof input !== "object" ||
          input === null ||
          !("url" in input) ||
          typeof input.url !== "string" ||
          !("token" in input) ||
          typeof input.token !== "string"
        )
          throw new Error("Invalid connection");
        const url = normalizeHostUrl(input.url);
        const id = hostId(url);
        const summary: HostSummary = {
          id,
          name: new URL(url).host,
          url,
          source: "manual",
        };
        manual.set(id, { summary, token: input.token });
        return json(res, 201, summary);
      } catch {
        return json(res, 400, {
          error: "Enter a valid HTTP or HTTPS API URL and token.",
        });
      }
    }

    const match = /^\/api\/hosts\/([a-f0-9]{24})(\/.*)$/.exec(url.pathname);
    const path = match?.[2] ?? "";
    if (match && path.startsWith("/marimo/")) {
      const host = (await connections()).get(match[1]);
      if (!host)
        return json(res, 404, {
          code: "host-unavailable",
          error: "This marimo host is no longer available.",
        });
      if (closed || res.destroyed) {
        res.destroy();
        return;
      }
      return native.handle(req, res, {
        connectionId: match[1],
        baseUrl: host.summary.url,
        path: path.slice("/marimo".length),
        url,
        origin: expected,
      });
    }
    const read =
      req.method === "GET" &&
      (path === "/events" || /^\/notebooks\/[^/]+\/events$/.test(path));
    const open = req.method === "POST" && /^\/notebooks\/[^/]+\/open$/.test(path);
    const save = req.method === "POST" && /^\/notebooks\/[^/]+\/save$/.test(path);
    const schema =
      req.method === "POST" && /^\/notebooks\/[^/]+\/edits$/.test(path)
        ? Protocol.EditRequest
        : save
          ? Protocol.SaveRequest
          : req.method === "POST" && /^\/notebooks\/[^/]+\/runtime\/runs$/.test(path)
            ? Protocol.RunRequest
            : req.method === "PUT" && /^\/notebooks\/[^/]+\/runtime$/.test(path)
              ? Protocol.StartRuntimeRequest
              : undefined;
    // Cancelling one run and interrupting the runtime are distinct operations.
    const mutation =
      open ||
      schema !== undefined ||
      (req.method === "DELETE" &&
        /^\/notebooks\/[^/]+\/runtime(?:\/runs\/[^/]+)?$/.test(path)) ||
      (req.method === "POST" && /^\/notebooks\/[^/]+\/runtime\/interrupt$/.test(path));
    if (!match || !(read || mutation)) {
      return json(res, 404, { error: "This proxy does not expose that operation." });
    }
    if (mutation && req.headers.origin !== expected) {
      return json(res, 403, { error: "An action must originate from the local app." });
    }
    if (mutation && typeof req.headers["idempotency-key"] !== "string") {
      return json(res, 400, { error: "The notebook request key is missing." });
    }
    const host = (await connections()).get(match[1]);
    if (!host) {
      return json(res, 404, {
        code: "host-unavailable",
        error: "This marimo host is no longer available. Refresh hosts.",
      });
    }
    let body: string | undefined;
    if (schema) {
      try {
        body = JSON.stringify(schema.parse(await readBody(req, 8 * 1024 * 1024)));
      } catch {
        return json(res, 400, { error: "Invalid notebook request." });
      }
    }
    if (closed || res.destroyed) {
      res.destroy();
      return;
    }
    const upstream = new URL(host.summary.url.replace(/\/$/, "") + path);
    // A browser can select stream filters, never an arbitrary proxy target.
    if (read) {
      for (const key of ["types", "cursor", "run_id"]) {
        const value = url.searchParams.get(key);
        if (value !== null) upstream.searchParams.set(key, value);
      }
    }
    const controller = new AbortController();
    // Raw SSE comments count as activity even when no notebook state changes.
    const abort = () => controller.abort();
    let idle = setTimeout(abort, 45_000);
    const heartbeat = () => {
      clearTimeout(idle);
      idle = setTimeout(abort, 45_000);
    };
    requests.set(controller, res);
    res.once("close", () => {
      clearTimeout(idle);
      controller.abort();
      requests.delete(controller);
    });
    try {
      const headers = new Headers();
      if (host.token) headers.set("Authorization", `Bearer ${host.token}`);
      if (mutation) {
        headers.set("Idempotency-Key", String(req.headers["idempotency-key"]));
        if (body !== undefined) headers.set("Content-Type", "application/json");
        if (save && typeof req.headers["if-match"] === "string") {
          headers.set("If-Match", req.headers["if-match"]);
        }
      } else {
        headers.set("Accept", "text/event-stream");
        headers.set("Marimo-Attachment-Kind", "browser");
        headers.set("Marimo-Attachment-Name", clientName);
        const cursor = req.headers["last-event-id"];
        if (typeof cursor === "string") headers.set("Last-Event-ID", cursor);
      }
      const response = await fetch(upstream, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
        redirect: "error",
      });
      if (open && response.ok) {
        // The host opens its browser; its returned URL may contain credentials.
        await response.body?.cancel();
        return json(res, 200, { success: true });
      }
      res.writeHead(response.status, {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      if (response.body) {
        const stream = NodeStream.Readable.from(response.body.values());
        stream.on("data", heartbeat);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      } else res.end();
    } catch {
      if (!res.destroyed) {
        if (res.headersSent) res.destroy();
        else
          json(res, 502, {
            error: "Could not reach the marimo host. It may have stopped.",
          });
      }
    }
  }

  return {
    launchKey,
    close: () => {
      closed = true;
      for (const [request, response] of requests) {
        request.abort();
        response.destroy();
      }
      native.close();
      manual.clear();
    },
    handle: (req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) => {
      void handle(req, res).catch(() => {
        if (res.destroyed) return;
        if (res.headersSent) res.destroy();
        else
          json(res, 500, {
            error: "Host discovery failed. Check the local marimo installation.",
          });
      });
    },
  };
}
