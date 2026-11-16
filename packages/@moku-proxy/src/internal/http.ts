import { Option, Schema } from "effect";
import * as NodeBuffer from "node:buffer";
import type * as NodeHttp from "node:http";

const failure = Schema.Struct({
  error: Schema.String,
  code: Schema.optionalKey(Schema.String),
});
const problemKinds = new Map<number, string>([
  [400, "invalid-request"],
  [401, "unauthorized"],
  [403, "forbidden"],
  [404, "not-found"],
  [500, "internal"],
]);

export function json(res: NodeHttp.ServerResponse, status: number, body: unknown) {
  const problem =
    status >= 400 ? Schema.decodeUnknownOption(failure)(body) : Option.none();
  if (Option.isSome(problem)) {
    const { error, code } = problem.value;
    if (code) res.setHeader("X-Moku-Error", code);
    const kind = problemKinds.get(status);
    body = {
      ...problem.value,
      type: kind ? `urn:marimo:problem:${kind}` : `urn:moku:problem:http-${status}`,
      title: error,
      status,
      detail: error,
    };
  }
  res.writeHead(status, {
    "Content-Type": Option.isSome(problem)
      ? "application/problem+json"
      : "application/json",
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
