/** Send launcher requests to the Moku proxy with the browser’s session cookie. @module */
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

/** Resolves proxy routes against the launch URL and sends same-origin credentials. */
export function make(
  baseUrl: string | URL,
  options: { fetch?: typeof globalThis.fetch } = {},
) {
  const base = new URL(baseUrl);
  const send = options.fetch ?? globalThis.fetch;
  const fetch: typeof globalThis.fetch = (input, init) =>
    send(input, { ...init, credentials: "same-origin", redirect: "error" });
  const url = (path: string) => new URL(path, base);
  const http = Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      return (yield* HttpClient.HttpClient).pipe(
        HttpClient.transformResponse(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        ),
        HttpClient.mapRequest((request) =>
          HttpClientRequest.setUrl(request, url(request.url)),
        ),
      );
    }),
  ).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
    Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false)),
  );
  return {
    /** The proxy routes used to open a marimo session and load its output assets. */
    marimo: (connectionId: string) => ({
      baseUrl: url(`/api/hosts/${encodeURIComponent(connectionId)}/marimo`),
      fetch,
    }),
    url,
    http,
  };
}
/** Routing and HTTP transport configured for one launcher proxy. */
export type Interface = ReturnType<typeof make>;
