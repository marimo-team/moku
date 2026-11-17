/** Use an in-memory fetch implementation for launcher HTTP requests. @module */
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

export const layer = (fetch: typeof globalThis.fetch) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch)),
  );
