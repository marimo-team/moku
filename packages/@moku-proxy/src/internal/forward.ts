import type * as NodeHttp from "node:http";
import * as NodeStream from "node:stream";

/** Own upstream cancellation and streaming for the lifetime of a browser response. */
export function create(
  res: NodeHttp.ServerResponse,
  requests: Map<AbortController, NodeHttp.ServerResponse>,
  timeout = 45_000,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  let idle = setTimeout(abort, timeout);
  const heartbeat = () => {
    clearTimeout(idle);
    // Raw SSE comments count as activity even without notebook state changes.
    idle = setTimeout(abort, 45_000);
  };
  requests.set(controller, res);
  res.once("close", () => {
    clearTimeout(idle);
    controller.abort();
    requests.delete(controller);
  });
  return {
    signal: controller.signal,
    pipe(response: Response, contentType: string) {
      res.writeHead(response.status, {
        "Content-Type": response.headers.get("content-type") ?? contentType,
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      if (!response.body) return res.end();
      const stream = NodeStream.Readable.from(response.body.values());
      stream.on("data", heartbeat);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    },
  };
}
