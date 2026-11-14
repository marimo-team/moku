/** Launcher proxy routing and transport configuration. @module */
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

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
    fetch,
    url,
    http,
  };
}
export type Proxy = ReturnType<typeof make>;
