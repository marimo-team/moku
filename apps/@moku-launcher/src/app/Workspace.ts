/**
 * Host connections and notebook catalogs for an authenticated proxy session.
 *
 * @module
 */
import {
  Data,
  Effect,
  Fiber,
  Option,
  RcMap,
  Schema,
  Semaphore,
  type Scope,
} from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Host from "@moku/core/Host";
import { RequestError } from "./request.ts";
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
 * Progress and the most recent failure of a connect or refresh operation.
 */
export type Status = Data.TaggedEnum<{
  Idle: {};
  Pending: {};
  Failed: { readonly error: RequestError };
}>;
/** Constructors and exhaustive matching for workspace request progress. */
export const Status = Data.taggedEnum<Status>();

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

  /** Shares a host until the last caller scope closes, bounded by this workspace. */
  readonly host: (
    connectionId: string,
  ) => Effect.Effect<Host.Interface, never, Scope.Scope>;

  /**
   * Returns a stable catalog atom for a connection.
   *
   * Observation shares the host with attached notebooks. The stream closes when
   * its last consumer releases it.
   */
  readonly catalog: (connectionId: string) => Host.Interface["state"];

  /**
   * Connects a host and adds it to `connections` on success.
   *
   * Existing observations restart with the updated credentials.
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
    status: Status.Idle(),
  });
  yield* Atom.mount(current);
  const setStatus = (status: Status) =>
    registry.update(current, (state) => ({ ...state, status }));
  const lock = yield* Semaphore.make(1);
  const update = <A>(operation: Effect.Effect<A, RequestError>) =>
    lock.withPermit(
      Effect.gen(function* () {
        setStatus(Status.Pending());
        return yield* operation.pipe(
          Effect.tapError((error) =>
            Effect.sync(() => setStatus(Status.Failed({ error }))),
          ),
          Effect.ensuring(
            Effect.sync(() =>
              registry.update(current, (state) =>
                state.status._tag === "Pending"
                  ? { ...state, status: Status.Idle() }
                  : state,
              ),
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
  const hosts = yield* RcMap.make({
    lookup: (connectionId: string) =>
      Host.make({
        baseUrl: proxy.url(`/api/hosts/${encodeURIComponent(connectionId)}`),
      }).pipe(Effect.provideService(HttpClient.HttpClient, transport)),
  });
  const host = (connectionId: string) => RcMap.get(hosts, connectionId);
  const handles = Atom.family((connectionId: string) =>
    Atom.make(host(connectionId)).pipe(Atom.setIdleTTL(0)),
  );
  const catalog = Atom.family((connectionId: string) =>
    Atom.readable((get) => {
      const handle = get(handles(connectionId));
      return AsyncResult.flatMap(handle, (host) => get(host.state));
    }).pipe(Atom.setIdleTTL(0)),
  );
  const workspace: Interface = {
    state: Atom.readable((get) => get(current)),
    refresh,
    catalog,
    host,
    open: ({ connectionId, notebookId }) =>
      owned(
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* host(connectionId);
            yield* connection.notebooks.open(notebookId);
          }),
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
              Effect.scoped(
                Effect.gen(function* () {
                  const existing = yield* RcMap.getOption(hosts, connection.id);
                  if (Option.isSome(existing)) yield* existing.value.reconnect;
                }),
              ),
            ),
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
