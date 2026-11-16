/** Route and validate wire requests using the host protocol definition. @module */
import { Schema } from "effect";
import type { HttpApiEndpoint } from "effect/http-api";
import * as Host from "@marimo-team/host-protocol/Host";
import type * as NodeHttp from "node:http";
import { readBody } from "./http.ts";

const routes = Object.values(Host.Api.groups).flatMap((group) =>
  Object.values(group.endpoints).map((endpoint: HttpApiEndpoint.Top) => {
    const names: string[] = [];
    const pattern = endpoint.path
      .split("/")
      .map((part) => {
        if (part.startsWith(":")) {
          names.push(part.slice(1));
          return "([^/]+)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { endpoint, names, pattern: new RegExp(`^${pattern}$`) };
  }),
);
const strings = Schema.Record(Schema.String, Schema.String);
const decode = (schema: Schema.Top, input: unknown) =>
  Schema.decodeUnknownSync(Schema.toEncoded(schema))(input);

export function match(method: string | undefined, path: string) {
  for (const route of routes) {
    if (route.endpoint.method !== method) continue;
    const found = route.pattern.exec(path);
    if (found)
      return {
        endpoint: route.endpoint,
        params: Object.fromEntries(
          route.names.map((name, i) => [name, decodeURIComponent(found[i + 1])]),
        ),
      };
  }
}

export async function prepare(
  route: { endpoint: HttpApiEndpoint.Top; params: Record<string, string> },
  req: NodeHttp.IncomingMessage,
  url: URL,
) {
  const { endpoint } = route;
  if (endpoint.params) decode(endpoint.params, route.params);
  const headers = endpoint.headers
    ? Schema.decodeUnknownSync(strings)(decode(endpoint.headers, req.headers))
    : {};
  const query = endpoint.query
    ? Schema.decodeUnknownSync(strings)(
        decode(endpoint.query, Object.fromEntries(url.searchParams)),
      )
    : {};
  let body: string | undefined;
  if (endpoint.payload.size > 0) {
    const payload = endpoint.payload.get("application/json");
    if (!payload) throw new Error("Expected a JSON request.");
    const schema = Schema.Union(payload.schemas.filter(Schema.isSchema));
    const value = Schema.decodeUnknownSync(Schema.toEncoded(schema), {
      onExcessProperty: "error",
    })(await readBody(req, 8 * 1024 * 1024));
    body = JSON.stringify(value);
  }
  return { headers: new Headers(headers), query, body };
}
