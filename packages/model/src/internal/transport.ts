import { Client } from "@marimo-team/client";
import { Context, Data, Effect, Layer, Schema } from "effect";

export class RequestError extends Data.TaggedError("RequestError")<{
  readonly message: string;
  readonly status?: number;
  readonly code?: string;
  readonly cause?: unknown;
  readonly problem?: unknown;
}> {}

export const failure = (cause: unknown): RequestError =>
  cause instanceof RequestError
    ? cause
    : new RequestError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });

export function mutation<A>(
  perform: (signal: AbortSignal) => Promise<
    | { readonly ok: true; readonly data: A }
    | {
        readonly ok: false;
        readonly status: number;
        readonly problem: { readonly title: string; readonly detail?: string };
      }
  >,
) {
  return Effect.tryPromise({ try: perform, catch: failure }).pipe(
    Effect.flatMap((result) =>
      result.ok
        ? Effect.succeed(result.data)
        : Effect.fail(
            new RequestError({
              message: result.problem.detail ?? result.problem.title,
              status: result.status,
              problem: result.problem,
            }),
          ),
    ),
  );
}

export class Service extends Context.Service<
  Service,
  {
    readonly client: (connectionId: string, signal: AbortSignal) => Client;
    readonly json: <A>(
      path: string,
      schema: Schema.Codec<A, unknown>,
      options?: RequestInit,
    ) => Effect.Effect<A, RequestError>;
  }
>()("@momo/Transport") {}

export const layer = (
  baseUrl: string | URL,
  options: { fetch?: typeof globalThis.fetch } = {},
) => {
  const base = new URL(baseUrl);
  const send = options.fetch ?? globalThis.fetch;
  const fetch: typeof globalThis.fetch = (input, init) =>
    send(input, { ...init, credentials: "same-origin", redirect: "error" });
  return Layer.succeed(
    Service,
    Service.of({
      client: (connectionId, lifetime) =>
        new Client(new URL(`/api/hosts/${encodeURIComponent(connectionId)}`, base), {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([lifetime, init.signal])
                : lifetime,
            }),
        }),
      json: (path, schema, options) =>
        Effect.tryPromise({
          try: async (signal) => {
            const response = await fetch(new URL(path, base), {
              ...options,
              signal: options?.signal
                ? AbortSignal.any([signal, options.signal])
                : signal,
            });
            const body: unknown = await response.json();
            if (!response.ok) {
              const error = Schema.decodeUnknownOption(
                Schema.Struct({
                  error: Schema.String,
                  code: Schema.optionalKey(Schema.String),
                }),
              )(body);
              throw new RequestError({
                message:
                  error._tag === "Some"
                    ? error.value.error
                    : `Request failed (${response.status}).`,
                status: response.status,
                code: error._tag === "Some" ? error.value.code : undefined,
                problem: body,
              });
            }
            return Schema.decodeUnknownSync(schema)(body);
          },
          catch: failure,
        }),
    }),
  );
};
