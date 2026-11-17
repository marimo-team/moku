/**
 * Host connections and notebook catalogs for an authenticated proxy session.
 *
 * @module
 */
import { Data, Effect, Fiber, Option, RcMap, Schema, Semaphore } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Host from "@moku/core/Host";
import * as Notebook from "./Notebook.ts";
import { RequestError } from "./request.ts";
import { FetchHttpClient, HttpBody, HttpClient, HttpClientResponse } from "effect/http";

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
/** Credentials for registering a host with the launcher proxy. */
export interface ConnectInput {
  /** The versioned host protocol API URL. */
  readonly url: string;
  /** Bearer token the proxy will send to that API. */
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

  /** Attaches a notebook on the selected host for the caller's scope. */
  readonly attach: (target: Notebook.Target) => ReturnType<typeof Notebook.make>;

  /**
   * Returns a stable catalog atom for a connection.
   *
   * Observation shares the host with attached notebooks. The stream closes when
   * its last consumer releases it.
   */
  readonly catalog: (connectionId: string) => Host.Interface["state"];

  /**
   * Registers a host URL and bearer token with the proxy.
   *
   * Registering the same URL again restarts its open streams with the new token.
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
}

const failure = (cause: unknown) =>
  cause instanceof RequestError
    ? cause
    : new RequestError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
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

/** Opens a launcher session and shares host connections between catalogs and notebook views. */
export const make = Effect.fnUntraced(function* (options: {
  baseUrl: string | URL;
  launchKey?: string;
  fetch?: typeof globalThis.fetch;
}) {
  const sessionUrl = new URL("/api/session", options.baseUrl).href;
  const hostsUrl = new URL("/api/hosts", options.baseUrl).href;
  const hostUrl = (id: string) => hostsUrl + "/" + encodeURIComponent(id);
  const marimoUrl = (id: string) => new URL(hostUrl(id) + "/marimo");
  const send = options.fetch ?? globalThis.fetch;
  const fetch: typeof globalThis.fetch = (input, init) =>
    send(input, { ...init, credentials: "same-origin", redirect: "error" });
  const transport = yield* HttpClient.HttpClient.pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
  );
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
      ? http.post(sessionUrl, {
          headers: { Authorization: `Bearer ${options.launchKey}` },
        })
      : http.get(sessionUrl)
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
      http.get(hostsUrl).pipe(
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
        baseUrl: hostUrl(connectionId),
        marimo: { baseUrl: marimoUrl(connectionId), fetch },
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
    attach: Effect.fnUntraced(function* (target) {
      return yield* Notebook.make(
        yield* host(target.connectionId),
        target,
        marimoUrl(target.connectionId),
      );
    }),
    open: ({ connectionId, notebookId }) =>
      owned(
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* host(connectionId);
            yield* connection.notebooks.open(notebookId);
          }),
        ),
      ),
    connect: (input) =>
      update(
        owned(
          http.post(hostsUrl, { body: HttpBody.jsonUnsafe(input) }).pipe(
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
