/**
 * Host connections and notebook catalogs for an authenticated proxy session.
 *
 * @module
 */
import { Cause, Effect, Fiber, Schema, Semaphore } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Host from "@moku/core/Host";
import type * as Protocol from "@moku/core/Protocol";
import { RequestError, type Observation } from "./request.ts";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";
import type * as Proxy from "./Proxy.ts";

/**
 * A discovered or manually connected host, without its authentication token.
 */
export const Connection = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  url: Schema.String,
  source: Schema.Literals(["local", "manual"]),
  pid: Schema.optionalKey(Schema.Number),
});
export type Connection = typeof Connection.Type;
export interface ConnectInput {
  readonly url: string;
  readonly token: string;
}

/**
 * Notebook records observed on one host.
 */
export interface Catalog {
  /**
   * Whether the initial catalog snapshot has finished arriving.
   */
  readonly ready: boolean;
  readonly notebooks: Readonly<Record<string, Protocol.NotebookOutput>>;
}

/**
 * Progress and the most recent failure of a connect or refresh operation.
 */
export interface Status {
  readonly pending: boolean;
  readonly error: RequestError | null;
}

/**
 * Host connections and the progress of discovery or connection requests.
 */
export interface State {
  readonly connections: readonly Connection[];
  readonly status: Status;
}

/**
 * Host connections and catalogs read through the registry that created them.
 */
export interface Interface {
  /**
   * Read-only connections and request status, updated through model operations.
   */
  readonly state: Atom.Atom<State>;

  /**
   * Returns a stable catalog atom for a connection.
   *
   * The catalog stream opens when the atom is observed and closes when released.
   */
  readonly catalog: (connectionId: string) => Atom.Atom<Observation<Catalog>>;

  /**
   * Connects a host and adds it to `connections` on success.
   */
  readonly connect: (input: ConnectInput) => Effect.Effect<Connection, RequestError>;

  /**
   * Rediscovers hosts and replaces the current connection list.
   */
  readonly refresh: Effect.Effect<void, RequestError>;

  /** Ask a host to open its own notebook interface. */
  readonly open: (input: {
    readonly connectionId: string;
    readonly notebookId: string;
    readonly requestId: string;
  }) => Effect.Effect<void, RequestError>;

  /**
   * Stores native output credentials on the proxy, separately from host API credentials.
   *
   * Retry the notebook's runtime connection after authorization succeeds.
   */
  readonly authorizeInteractions: (input: {
    readonly connectionId: string;
    readonly token: string;
  }) => Effect.Effect<void, RequestError>;
}
const empty: Catalog = { ready: false, notebooks: {} };

const failure = (cause: unknown) =>
  cause instanceof RequestError
    ? cause
    : new RequestError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
const Success = Schema.Struct({ success: Schema.Literal(true) });
const Problem = Schema.Struct({
  error: Schema.String,
  code: Schema.optionalKey(Schema.String),
});

const checkResponse = Effect.fnUntraced(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  if (response.status >= 200 && response.status < 300) return response;
  const body = yield* response.json.pipe(Effect.catch(() => Effect.succeed(undefined)));
  const error = Schema.decodeUnknownOption(Problem)(body);
  return yield* Effect.fail(
    new RequestError({
      message:
        error._tag === "Some"
          ? error.value.error
          : `Request failed (${response.status}).`,
      status: response.status,
      code: error._tag === "Some" ? error.value.code : undefined,
      problem: body,
    }),
  );
});

/** Authenticate a launcher session and acquire its host catalogs. */
export const make = Effect.fnUntraced(function* (
  proxy: Proxy.Interface,
  options: { launchKey?: string } = {},
) {
  const transport = yield* HttpClient.HttpClient;
  const http = transport.pipe(
    HttpClient.transformResponse(Effect.flatMap(checkResponse)),
  );
  const registry = yield* AtomRegistry.AtomRegistry;
  const owner = yield* Effect.scope;
  const lifetime = yield* Effect.abortSignal;
  // Commands execute after construction and must end with either their caller or workspace.
  const owned = <A, E>(operation: Effect.Effect<A, E>) =>
    Effect.acquireUseRelease(
      Effect.forkIn(operation, owner),
      Fiber.join,
      Fiber.interrupt,
    ).pipe(Effect.mapError(failure));
  yield* owned(
    (options.launchKey
      ? http.post("/api/session", {
          headers: { Authorization: `Bearer ${options.launchKey}` },
        })
      : http.get("/api/session")
    ).pipe(
      Effect.flatMap(
        HttpClientResponse.schemaBodyJson(
          Schema.Struct({ authenticated: Schema.Literal(true) }),
        ),
      ),
    ),
  );
  const current = Atom.make<State>({
    connections: [],
    status: { pending: false, error: null },
  });
  yield* Atom.mount(current);
  const setStatus = (status: Status) =>
    registry.update(current, (state) => ({ ...state, status }));
  const lock = yield* Semaphore.make(1);
  const update = <A>(operation: Effect.Effect<A, RequestError>) =>
    lock.withPermit(
      Effect.gen(function* () {
        setStatus({ pending: true, error: null });
        return yield* operation.pipe(
          Effect.tapError((error) =>
            Effect.sync(() => setStatus({ pending: false, error })),
          ),
          Effect.ensuring(
            Effect.sync(() =>
              registry.update(current, (state) => ({
                ...state,
                status: { ...state.status, pending: false },
              })),
            ),
          ),
        );
      }),
    );
  const refresh = update(
    owned(
      http.get("/api/hosts").pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Array(Connection))),
        Effect.tap((connections) =>
          Effect.sync(() =>
            registry.update(current, (state) => ({ ...state, connections })),
          ),
        ),
      ),
    ),
  ).pipe(Effect.asVoid);
  const hosts = Atom.family((connectionId: string) =>
    Atom.make(
      Host.make({
        baseUrl: proxy.url(`/api/hosts/${encodeURIComponent(connectionId)}`),
      }).pipe(Effect.provideService(HttpClient.HttpClient, transport)),
    ).pipe(Atom.setIdleTTL(0)),
  );
  const catalog = Atom.family((connectionId: string) =>
    Atom.readable((get): Observation<Catalog> => {
      const host = get(hosts(connectionId));
      if (!AsyncResult.isSuccess(host))
        return {
          value: empty,
          status: AsyncResult.isFailure(host) ? "error" : "connecting",
          error: AsyncResult.isFailure(host) ? failure(Cause.squash(host.cause)) : null,
        };
      const state = get(host.value.state);
      const value = AsyncResult.getOrElse(state, () => undefined);
      const error = AsyncResult.isFailure(state)
        ? failure(Cause.squash(state.cause))
        : null;
      return {
        value:
          value && "notebooks" in value
            ? { ready: !state.waiting, notebooks: value.notebooks }
            : empty,
        status: lifetime.aborted
          ? "closed"
          : error
            ? "error"
            : state.waiting
              ? "connecting"
              : "connected",
        error,
      };
    }).pipe(Atom.setIdleTTL(0)),
  );
  const workspace: Interface = {
    state: Atom.readable((get) => get(current)),
    refresh,
    catalog,
    open: ({ connectionId, notebookId, requestId }) =>
      owned(
        http
          .post(
            `/api/hosts/${encodeURIComponent(connectionId)}/notebooks/${encodeURIComponent(notebookId)}/open`,
            {
              headers: { "Idempotency-Key": requestId },
            },
          )
          .pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Success)),
            Effect.asVoid,
          ),
      ),
    authorizeInteractions: ({ connectionId, token }) =>
      owned(
        http
          .post(`/api/hosts/${encodeURIComponent(connectionId)}/marimo/auth`, {
            body: HttpBody.jsonUnsafe({ token }),
          })
          .pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Success)),
            Effect.asVoid,
          ),
      ),
    connect: (input) =>
      update(
        owned(
          http.post("/api/hosts", { body: HttpBody.jsonUnsafe(input) }).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Connection)),
            Effect.tap((connection) =>
              Effect.sync(() =>
                registry.update(current, (state) => ({
                  ...state,
                  connections: [
                    ...state.connections.filter((item) => item.id !== connection.id),
                    connection,
                  ],
                })),
              ),
            ),
          ),
        ),
      ),
  };
  yield* Effect.forkScoped(refresh.pipe(Effect.catch(() => Effect.void)));
  return workspace;
});
