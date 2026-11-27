import * as Problems from "@marimo-team/host-protocol/Problems";
/** Host protocol transport and scoped command lifetimes. @module */
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Redacted,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { Api } from "./api.ts";

export type Client = Effect.Success<ReturnType<typeof makeClient>>;
/** A comm POST with its notebook path already bound. */
export type CommRequest = Pick<
  Parameters<Client["Comm"]["send"]>[0],
  "payload" | "headers"
>;
const knownProblems = new Set<string>(
  Problems.Problem.members.map((problem) => problem.fields.type.schema.literal),
);
/** A local lifecycle, transaction, or observation failure. */
export class ModelError extends Schema.TaggedError<ModelError>()("ModelError", {
  /** The operation or lifecycle constraint that prevented progress. */
  reason: Schema.Literals([
    "closed",
    "invalid-edit",
    "invalid-state",
    "runtime-stopped",
    "retry-expired",
  ]),
  /** A description suitable for displaying to a caller. */
  message: Schema.String,
}) {}

/**
 * Whether the host definitively rejected a command without accepting its work.
 *
 * These responses retire the request key. Transport and server failures retain it
 * so retrying cannot repeat work whose outcome is unknown.
 */
export function isRejection(
  error: unknown,
): error is typeof Problems.Problem.Type | typeof Problems.UnknownProblem.Type {
  return (
    (Schema.is(Problems.Problem)(error) || Schema.is(Problems.UnknownProblem)(error)) &&
    error.status < 500
  );
}

export const makeClient = Effect.fnUntraced(function* (options: {
  readonly baseUrl: string | URL;
  readonly token?: Redacted.Redacted<string>;
}) {
  const services = Context.omit(Scope.Scope)(yield* Effect.context<never>());
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequestInput(HttpClientRequest.prependUrl(String(options.baseUrl))),
    HttpClient.transformResponse(Effect.provideContext(services)),
    HttpClient.mapRequest((request) =>
      options.token ? HttpClientRequest.bearerToken(request, options.token) : request,
    ),
    HttpClient.transformResponse(
      Effect.flatMap(
        Effect.fnUntraced(function* (response) {
          if (
            response.status >= 400 &&
            response.status < 600 &&
            response.headers["content-type"]?.split(";", 1)[0]?.trim() ===
              "application/problem+json"
          ) {
            const problem = yield* Schema.decodeUnknownEffect(Problems.UnknownProblem)(
              yield* response.json,
            );
            // Known problems still use the endpoint's stricter schema. New problem
            // types use their status without losing the host's details or extensions.
            if (!knownProblems.has(problem.type)) {
              if (problem.status !== response.status) {
                return yield* Effect.fail(
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.DecodeError({
                      request: response.request,
                      response,
                      description:
                        "The problem status does not match the HTTP response.",
                    }),
                  }),
                );
              }
              return yield* Effect.fail(problem);
            }
          }
          return response;
        }),
      ),
    ),
    HttpClient.transformResponse(
      Effect.map(
        (response) =>
          new Proxy(response, {
            get(target, property, receiver) {
              // Measure incoming bytes, including SSE heartbeat comments.
              if (
                property === "stream" &&
                target.headers["content-type"]?.includes("text/event-stream")
              ) {
                return target.stream.pipe(
                  Stream.timeout("45 seconds"),
                  Stream.mapError(
                    (cause) =>
                      new HttpClientError.HttpClientError({
                        reason: new HttpClientError.DecodeError({
                          request: target.request,
                          response: target,
                          cause,
                          description: "The event stream stopped receiving heartbeats.",
                        }),
                      }),
                  ),
                );
              }
              return Reflect.get(target, property, receiver);
            },
          }),
      ),
    ),
  );
  return yield* HttpApiClient.makeWith(Api, { httpClient: http });
});

export const makeCommands = Effect.fnUntraced(function* (
  retryWindow: Duration.Input = "60 seconds",
) {
  const retryMillis = Duration.toMillis(Duration.fromInputUnsafe(retryWindow));
  const owner = yield* Effect.scope;
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }),
  );
  const owned = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E | ModelError> =>
    Effect.suspend<A, E | ModelError, never>(() =>
      closed
        ? Effect.fail(
            new ModelError({ reason: "closed", message: "The model is closed." }),
          )
        : Effect.acquireUseRelease(
            Effect.forkIn(effect, owner),
            Fiber.join,
            Fiber.interrupt,
          ),
    );
  return {
    owned,
    mutation: <A, E>(prepare: (key: string) => Effect.Effect<A, E>) => {
      const semaphore = Semaphore.makeUnsafe(1);
      let command: { effect: Effect.Effect<A, E>; started: number } | undefined;
      return owned(
        semaphore.withPermit(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            if (command && now - command.started >= retryMillis)
              return yield* Effect.fail(
                new ModelError({
                  reason: "retry-expired",
                  message: "The mutation's retry window has expired.",
                }),
              );
            command ??= { effect: prepare(crypto.randomUUID()), started: now };
            return yield* command.effect.pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  if (
                    Exit.isSuccess(exit) ||
                    (Exit.isFailure(exit) && isRejection(Cause.squash(exit.cause)))
                  )
                    command = undefined;
                }),
              ),
            );
          }),
        ),
      );
    },
  };
});
