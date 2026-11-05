import * as NodeCrypto from "node:crypto";
import * as NodeBuffer from "node:buffer";
import type * as NodeHttp from "node:http";
import * as NodeStream from "node:stream";
import { discoverHosts } from "@marimo-team/client/node";
import type { HostRecordOutput } from "@marimo-team/client/protocol";

export interface HostSummary {
  id: string;
  name: string;
  url: string;
  pid: number;
}

interface Options {
  origin: () => string;
  discover?: () => AsyncIterable<HostRecordOutput>;
}

function matches(actual: string | undefined, expected: string) {
  const value = NodeBuffer.Buffer.from(actual ?? "");
  const target = NodeBuffer.Buffer.from(expected);
  return value.length === target.length && NodeCrypto.timingSafeEqual(value, target);
}

function json(res: NodeHttp.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: NodeHttp.IncomingMessage) {
  const chunks: NodeBuffer.Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = NodeBuffer.Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 65536) throw new Error("Request is too large");
    chunks.push(buffer);
  }
  return NodeBuffer.Buffer.concat(chunks);
}

export function createApi({ origin, discover = discoverHosts }: Options) {
  const launchKey = NodeCrypto.randomBytes(32).toString("hex");
  const sessionKey = NodeCrypto.randomBytes(32).toString("hex");
  const cookieName = `dag_${NodeCrypto.randomBytes(8).toString("hex")}`;

  async function hosts() {
    const records = new Map<string, HostRecordOutput>();
    for await (const host of discover()) {
      const id = NodeCrypto.createHash("sha256")
        .update(`${host.url}:${host.process.pid}:${host.process.started_at}`)
        .digest("hex")
        .slice(0, 24);
      records.set(id, host);
    }
    return records;
  }

  async function handle(req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) {
    const expected = origin();
    if (
      req.headers.host !== new URL(expected).host ||
      (req.headers.origin !== undefined && req.headers.origin !== expected) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      json(res, 403, {
        error: "Open the local launch link printed in your terminal.",
      });
      return;
    }
    const url = new URL(req.url ?? "/", expected);
    if (url.pathname === "/api/session" && req.method === "POST") {
      if (
        req.headers.origin !== expected ||
        !matches(req.headers.authorization, `Bearer ${launchKey}`)
      ) {
        json(res, 401, {
          error: "This launch link is invalid. Use the link printed by the running server.",
        });
        return;
      }
      res.setHeader("Set-Cookie", `${cookieName}=${sessionKey}; HttpOnly; SameSite=Strict; Path=/`);
      json(res, 200, { authenticated: true });
      return;
    }
    const cookie = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    if (!matches(cookie, sessionKey)) {
      json(res, 401, {
        error: "Open the authenticated launch link from your terminal.",
      });
      return;
    }
    if (url.pathname === "/api/session" && req.method === "GET") {
      json(res, 200, { authenticated: true });
      return;
    }
    if (url.pathname === "/api/hosts" && req.method === "GET") {
      const entries = await hosts();
      json(
        res,
        200,
        [...entries].map(([id, host]): HostSummary => ({
          id,
          name: host.name,
          url: host.url,
          pid: host.process.pid,
        })),
      );
      return;
    }
    const match = /^\/api\/hosts\/([a-f0-9]{24})(\/.*)$/.exec(url.pathname);
    const path = match?.[2];
    const read = path === "/events" || /^\/notebooks\/[^/]+\/events$/.test(path ?? "");
    const write =
      (req.method === "PUT" && /^\/notebooks\/[^/]+\/runtime$/.test(path ?? "")) ||
      (req.method === "POST" && /^\/notebooks\/[^/]+\/runtime\/runs$/.test(path ?? "")) ||
      (req.method === "DELETE" && /^\/notebooks\/[^/]+\/runtime\/runs\/[^/]+$/.test(path ?? ""));
    if (!match || !((req.method === "GET" && read) || write)) {
      json(res, 404, { error: "This viewer does not expose that operation." });
      return;
    }
    if (write && req.headers.origin !== expected) {
      json(res, 403, { error: "An action must originate from this viewer." });
      return;
    }
    const host = (await hosts()).get(match[1]);
    if (!host) {
      json(res, 404, {
        error: "This marimo host is no longer running. Refresh hosts.",
      });
      return;
    }
    const upstream = new URL(host.url.replace(/\/$/, "") + path);
    // Only protocol stream filters are forwarded. Targets always come from discovery.
    for (const key of ["types", "cursor", "run_id"]) {
      const value = url.searchParams.get(key);
      if (value !== null) upstream.searchParams.set(key, value);
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    res.on("close", abort);
    try {
      const headers = new Headers({ Authorization: `Bearer ${host.token}` });
      headers.set("Marimo-Attachment-Kind", "browser");
      headers.set("Marimo-Attachment-Name", "dag");
      for (const name of ["last-event-id", "idempotency-key", "content-type", "accept"]) {
        const value = req.headers[name];
        if (typeof value === "string") headers.set(name, value);
      }
      const body = req.method === "POST" || req.method === "PUT" ? await readBody(req) : undefined;
      const response = await fetch(upstream, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
        redirect: "error",
      });
      res.writeHead(response.status, {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      if (response.body) {
        const stream = NodeStream.Readable.from(response.body.values());
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
    handle: (req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) => {
      void handle(req, res).catch(() => {
        if (res.headersSent) res.destroy();
        else
          json(res, 500, {
            error: "Host discovery failed. Check the local marimo installation.",
          });
      });
    },
  };
}
