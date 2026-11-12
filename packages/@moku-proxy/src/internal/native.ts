/**
 * Allowlisted native output routes with server-side marimo credentials.
 *
 * @module
 */
import type * as Http from "node:http";
import { Readable } from "node:stream";
import { Schema } from "effect";
import { ComponentValues, FunctionCall, ModelValue } from "@moku/core/Interaction";
import { json, readBody } from "./http.ts";

const routes = {
  "/api/kernel/set_ui_element_value": ComponentValues,
  "/api/kernel/function_call": FunctionCall,
  "/api/kernel/set_model_value": ModelValue,
};
const sessionPattern = /^[a-zA-Z0-9_-]{1,128}$/;

export function createNative(
  requests: Map<AbortController, Http.ServerResponse>,
  clientName: string,
) {
  const credentials = new Map<string, { token: string; serverToken: string }>();
  return {
    close: () => credentials.clear(),
    async handle(
      req: Http.IncomingMessage,
      res: Http.ServerResponse,
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
          error: "This host does not expose native marimo outputs.",
        });
      const nativeBase = base.slice(0, -"/api/marimo/v1".length);
      const auth = path === "/auth" && req.method === "POST";
      const stream = path === "/sse" && req.method === "GET";
      const asset = path.startsWith("/@file/") && req.method === "GET";
      const schema = Object.hasOwn(routes, path)
        ? routes[path as keyof typeof routes]
        : undefined;
      const mutation = schema !== undefined && req.method === "POST";
      if (!(auth || stream || asset || mutation))
        return json(res, 404, { error: "This native operation is not exposed." });
      if ((auth || mutation) && req.headers.origin !== origin)
        return json(res, 403, {
          error: "An action must originate from the local app.",
        });
      const controller = new AbortController();
      requests.set(controller, res);
      let idle = setTimeout(() => controller.abort(), stream ? 45_000 : 30_000);
      const heartbeat = () => {
        clearTimeout(idle);
        idle = setTimeout(() => controller.abort(), 45_000);
      };
      res.once("close", () => {
        clearTimeout(idle);
        controller.abort();
        requests.delete(controller);
      });
      try {
        if (auth) {
          let input: { readonly token?: string };
          try {
            input = Schema.decodeUnknownSync(
              Schema.Struct({ token: Schema.optionalKey(Schema.String) }),
            )(await readBody(req));
          } catch {
            return json(res, 400, { error: "Invalid interaction credentials." });
          }
          if (input.token === undefined && credentials.has(connectionId))
            return json(res, 200, { success: true });
          const token = input.token ?? "";
          const response = await fetch(nativeBase + "/", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            redirect: "manual",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
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
          if (controller.signal.aborted) return;
          credentials.set(connectionId, { token, serverToken });
          return json(res, 200, { success: true });
        }
        const credential = credentials.get(connectionId);
        if (!credential)
          return json(res, 401, {
            error: "Authorize interactions with the marimo server token.",
          });
        const upstream = new URL(nativeBase + path);
        let body: string | undefined;
        const headers = new Headers();
        if (credential.token)
          headers.set("Authorization", `Bearer ${credential.token}`);
        if (stream) {
          const sessionId = url.searchParams.get("session_id");
          const file = url.searchParams.get("file");
          if (
            !sessionId ||
            !sessionPattern.test(sessionId) ||
            !file ||
            file.length > 4096
          )
            return json(res, 400, {
              error: "A session ID and notebook path are required.",
            });
          upstream.searchParams.set("session_id", sessionId);
          upstream.searchParams.set("file", file);
          // Viewer attachment never starts a kernel or replaces an editor consumer.
          upstream.searchParams.set("kiosk", "true");
          upstream.searchParams.set("types", "notebook,runtime,marimo");
          headers.set("Accept", "text/event-stream");
          headers.set("Marimo-Attachment-Kind", "browser");
          headers.set("Marimo-Attachment-Name", clientName);
        }
        if (asset) {
          const decoded = decodeURIComponent(path);
          if (decoded.includes("\\") || decoded.split("/").includes(".."))
            return json(res, 400, { error: "Invalid output asset path." });
        }
        if (mutation) {
          const sessionId = req.headers["marimo-session-id"];
          if (typeof sessionId !== "string" || !sessionPattern.test(sessionId))
            return json(res, 400, { error: "The output session ID is missing." });
          try {
            body = JSON.stringify(
              Schema.decodeUnknownSync(schema!)(await readBody(req, 8 * 1024 * 1024)),
            );
          } catch {
            return json(res, 400, { error: "Invalid output interaction request." });
          }
          headers.set("Content-Type", "application/json");
          headers.set("Marimo-Session-Id", sessionId);
          headers.set("Marimo-Server-Token", credential.serverToken);
        }
        if (controller.signal.aborted) return;
        const response = await fetch(upstream, {
          method: req.method,
          headers,
          body,
          signal: controller.signal,
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
        res.writeHead(response.status, {
          "Content-Type":
            response.headers.get("content-type") ?? "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        if (!response.body) return res.end();
        const output = Readable.from(response.body.values());
        output.on("data", heartbeat);
        output.on("error", () => res.destroy());
        output.pipe(res);
      } catch {
        if (res.destroyed) return;
        if (res.headersSent) res.destroy();
        else json(res, 502, { error: "Could not reach the native output session." });
      }
    },
  };
}
