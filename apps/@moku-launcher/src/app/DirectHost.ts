/** Browser connections to a user-supplied host protocol endpoint. @module */
import { Effect, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { RequestError } from "./request.ts";

/** The host API address and the bearer token issued by that host. */
export interface Input {
  /** The API base URL. A bare origin uses the default marimo host path. */
  readonly url: string;
  /** The bearer token to send to this host. */
  readonly token: string;
}

/** Validate the catalog endpoint before making the credentials available to notebook views. */
export const connect = Effect.fnUntraced(function* (
  input: Input,
  http: HttpClient.HttpClient,
) {
  const url = URL.parse(input.url);
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return yield* new RequestError({
      message:
        "Enter an HTTP or HTTPS host API URL without credentials, a query, or a fragment.",
    });
  if (!input.token.trim())
    return yield* new RequestError({ message: "Enter the host token." });
  if (url.pathname === "/") url.pathname = "/api/marimo/v1";
  const baseUrl = url.href.replace(/\/+$/, "");
  const token = Redacted.make(input.token.trim());
  yield* Effect.scoped(
    Effect.gen(function* () {
      const response = yield* HttpClient.withScope(http)
        .execute(
          HttpClientRequest.get(baseUrl + "/events", {
            accept: "text/event-stream",
          }).pipe(HttpClientRequest.bearerToken(token)),
        )
        .pipe(
          Effect.timeout("10 seconds"),
          Effect.mapError(
            () =>
              new RequestError({
                message:
                  "Could not reach the host from this browser. Check the URL and whether the host allows this page’s origin.",
              }),
          ),
        );
      if (response.status === 401 || response.status === 403)
        return yield* new RequestError({
          message:
            "The host refused the connection. Check the host token and permissions.",
        });
      if (
        response.status !== 200 ||
        response.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
          "text/event-stream"
      )
        return yield* new RequestError({
          message: `The URL did not return a host catalog (HTTP ${response.status}).`,
        });
    }),
  );
  return { id: "direct:" + baseUrl, name: url.host, url: baseUrl, token };
});
