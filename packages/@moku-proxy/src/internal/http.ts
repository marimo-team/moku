import * as NodeBuffer from "node:buffer";
import type * as NodeHttp from "node:http";

export function json(res: NodeHttp.ServerResponse, status: number, body: unknown) {
  if (status >= 400 && typeof body === "object" && body !== null) {
    if ("code" in body && typeof body.code === "string") {
      res.setHeader("X-Moku-Error", body.code);
    }
    body = { ...body, status };
  }
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

export async function readBody(
  req: NodeHttp.IncomingMessage,
  limit = 16_384,
): Promise<unknown> {
  const chunks: NodeBuffer.Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = NodeBuffer.Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > limit) throw new Error("Request is too large");
    chunks.push(buffer);
  }
  return JSON.parse(NodeBuffer.Buffer.concat(chunks).toString());
}
