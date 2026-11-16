/**
 * Authenticated local routes for marimo host discovery, notebook commands, and events.
 *
 * @module
 */
import * as NodeCrypto from "node:crypto";
import * as NodeBuffer from "node:buffer";
import type * as NodeHttp from "node:http";
import * as Forward from "./internal/forward.ts";
import * as MarimoNode from "@marimo-team/client/node";
import { json, readBody } from "./internal/http.ts";
import type { ManagedServer } from "./internal/managed.ts";
import { createNative } from "./internal/native.ts";
import type * as Discovery from "@marimo-team/client/protocol";
import { Schema } from "effect";
import * as Protocol from "@marimo-team/host-protocol/Schemas";
import * as Routes from "./internal/protocol.ts";

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
  discover?: () => AsyncIterable<Discovery.HostRecordOutput>;
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
  discover = MarimoNode.discoverHosts,
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
    const add = (host: Discovery.HostRecordOutput) => {
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
    let route: ReturnType<typeof Routes.match>;
    try {
      route = Routes.match(req.method, path);
    } catch {
      return json(res, 400, { error: "Invalid notebook path." });
    }
    if (!match || !route) {
      return json(res, 404, { error: "This proxy does not expose that operation." });
    }
    const read = route.endpoint.method === "GET";
    if (!read && req.headers.origin !== expected) {
      return json(res, 403, { error: "An action must originate from the local app." });
    }
    const host = (await connections()).get(match[1]);
    if (!host) {
      return json(res, 404, {
        code: "host-unavailable",
        error: "This marimo host is no longer available. Refresh hosts.",
      });
    }
    let request: Awaited<ReturnType<typeof Routes.prepare>>;
    try {
      request = await Routes.prepare(route, req, url);
    } catch {
      return json(res, 400, { error: "Invalid host protocol request." });
    }
    if (closed || res.destroyed) {
      res.destroy();
      return;
    }
    const upstream = new URL(host.summary.url.replace(/\/$/, "") + path);
    upstream.search = new URLSearchParams(request.query).toString();
    const forward = Forward.create(res, requests);
    try {
      const { headers, body } = request;
      if (host.token) headers.set("Authorization", `Bearer ${host.token}`);
      if (body !== undefined) headers.set("Content-Type", "application/json");
      if (read) {
        headers.set("Accept", "text/event-stream");
        if (!headers.has("Marimo-Attachment-Kind"))
          headers.set("Marimo-Attachment-Kind", "browser");
        if (!headers.has("Marimo-Attachment-Name"))
          headers.set("Marimo-Attachment-Name", clientName);
      }
      const response = await fetch(upstream, {
        method: req.method,
        headers,
        body,
        signal: forward.signal,
        redirect: "error",
      });
      if (route.endpoint.identifier === "open" && response.ok) {
        const opened = Schema.decodeUnknownSync(Protocol.OpenNotebookResponse)(
          await response.json(),
        );
        // The pinned host includes its native token despite the protocol contract.
        const target = new URL(opened.url);
        target.searchParams.delete("access_token");
        return json(res, response.status, { url: target.href });
      }
      forward.pipe(response, "application/json");
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
