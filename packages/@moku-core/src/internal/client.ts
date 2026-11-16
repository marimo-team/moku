/** Native protocol transport and scoped command lifetimes. @module */
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
import * as Problems from "@marimo-team/host-protocol/Problems";

export type Client = HttpApiClient.ForApi<typeof Api>;
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
  return yield* HttpApiClient.make(Api).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
  );
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
                    (Exit.isFailure(exit) &&
                      Schema.is(Problems.Problem)(Cause.squash(exit.cause)))
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
