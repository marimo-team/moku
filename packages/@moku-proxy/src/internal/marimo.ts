/**
 * Forward widget requests to a running marimo server.
 *
 * On `POST /auth`, the proxy uses the supplied access token to load the marimo
 * page and read its server token. Later kernel requests carry that server token
 * and the ID of the widget’s session. The browser receives an acknowledgement.
 *
 * @module
 */
import type * as NodeHttp from "node:http";

import {
  LegacyCommApi,
  LegacySessionId,
  ViewerCredentials,
} from "@moku/core/internal/comm-protocol";
import { Schema } from "effect";

import * as Forward from "./forward.ts";
import { json, readBody } from "./http.ts";
import { prepare } from "./protocol.ts";

const endpoints = Object.values(LegacyCommApi.groups.LegacyComm.endpoints);
const isSessionId = Schema.is(LegacySessionId);

export function create(
  requests: Map<AbortController, NodeHttp.ServerResponse>,
  clientName: string,
) {
  const credentials = new Map<string, { token: string; serverToken: string }>();
  return {
    close: () => credentials.clear(),
    async handle(
      req: NodeHttp.IncomingMessage,
      res: NodeHttp.ServerResponse,
      options: {
        connectionId: string;
        baseUrl: string;
        path: string;
        url: URL;
        origin: string;
      },
    ) {
      const { connectionId, path, url, origin } = options;
      const base = options.baseUrl.replace(/\/+$/, "");
      if (!base.endsWith("/api/marimo/v1"))
        return json(res, 400, {
          error: "This host does not expose marimo output routes.",
        });
      const marimoBase = base.slice(0, -"/api/marimo/v1".length);
      const endpoint = endpoints.find(
        (endpoint) => endpoint.method === req.method && endpoint.path === path,
      );
      const stream = path === "/sse" && req.method === "GET";
      const asset = path.startsWith("/@file/") && req.method === "GET";
      if (!(endpoint || stream || asset))
        return json(res, 404, {
          error: "The proxy does not expose this marimo route.",
        });
      if (endpoint && req.headers.origin !== origin)
        return json(res, 403, {
          error: "An action must originate from the local app.",
        });
      const forward = Forward.create(res, requests, stream ? 45_000 : 30_000);
      try {
        if (endpoint?.identifier === "authorize") {
          let input: typeof ViewerCredentials.Type;
          try {
            input = Schema.decodeUnknownSync(ViewerCredentials)(await readBody(req));
          } catch {
            return json(res, 400, { error: "Invalid interaction credentials." });
          }
          if (input.token === undefined && credentials.has(connectionId))
            return json(res, 200, { success: true });
          const token = input.token ?? "";
          const response = await fetch(marimoBase + "/", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            redirect: "manual",
            signal: AbortSignal.any([forward.signal, AbortSignal.timeout(10_000)]),
          });
          if (!response.ok) {
            await response.body?.cancel();
            return json(res, response.status < 500 ? 401 : 502, {
              error:
                "Enter the marimo server's authentication token to connect outputs.",
            });
          }
          const html = await response.text();
          const serverToken =
            /<marimo-server-token\b[^>]*\bdata-token=["']([^"']+)["']/.exec(html)?.[1];
          if (!serverToken)
            return json(res, 502, {
              error: "The marimo server did not provide its interaction token.",
            });
          if (forward.signal.aborted) return;
          credentials.set(connectionId, { token, serverToken });
          return json(res, 200, { success: true });
        }
        const credential = credentials.get(connectionId);
        if (!credential)
          return json(res, 401, {
            error: "Authorize interactions with the marimo server token.",
          });
        const upstream = new URL(marimoBase + path);
        let body: string | undefined;
        const headers = new Headers();
        if (credential.token)
          headers.set("Authorization", `Bearer ${credential.token}`);
        if (stream) {
          const sessionId = url.searchParams.get("session_id");
          const file = url.searchParams.get("file");
          if (!isSessionId(sessionId) || !file || file.length > 4096)
            return json(res, 400, {
              error: "A session ID and notebook path are required.",
            });
          upstream.searchParams.set("session_id", sessionId);
          upstream.searchParams.set("file", file);
          // Viewer attachment never starts a kernel or replaces an editor consumer.
          upstream.searchParams.set("kiosk", "true");
          headers.set("Accept", "text/event-stream");
          headers.set("Marimo-Attachment-Kind", "browser");
          headers.set("Marimo-Attachment-Name", clientName);
        }
        if (asset) {
          const decoded = decodeURIComponent(path);
          if (decoded.includes("\\") || decoded.split("/").includes(".."))
            return json(res, 400, { error: "Invalid output asset path." });
        }
        if (endpoint) {
          try {
            const request = await prepare({ endpoint, params: {} }, req, url);
            body = request.body;
            request.headers.forEach((value, name) => headers.set(name, value));
          } catch {
            return json(res, 400, { error: "Invalid output interaction request." });
          }
          headers.set("Content-Type", "application/json");
          headers.set("Marimo-Server-Token", credential.serverToken);
        }
        if (forward.signal.aborted) return;
        const response = await fetch(upstream, {
          method: req.method,
          headers,
          body,
          signal: forward.signal,
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (response.status === 401 && credentials.get(connectionId) === credential)
            credentials.delete(connectionId);
          return json(res, response.status, {
            error: `Marimo refused the output request (${response.status}).`,
          });
        }
        forward.pipe(response, "application/octet-stream");
      } catch {
        if (res.destroyed) return;
        if (res.headersSent) res.destroy();
        else json(res, 502, { error: "Could not reach the marimo session." });
      }
    },
  };
}
