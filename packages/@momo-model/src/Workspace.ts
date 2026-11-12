/**
 * Host connections and notebook catalogs for an authenticated proxy session.
 *
 * @module
 */
import { Effect, Schema, Semaphore } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type { CatalogEvent } from "@marimo-team/client";
import type * as Protocol from "./Protocol.ts";
import * as Transport from "./internal/transport.ts";
import { observe, type Observation } from "./internal/observe.ts";

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
  readonly error: Transport.RequestError | null;
}

/**
 * Host connections and catalogs read through the registry that created them.
 */
export interface Workspace {
  readonly connections: Atom.Atom<readonly Connection[]>;
  readonly status: Atom.Atom<Status>;

  /**
   * Returns a stable catalog atom for a connection.
   *
   * The catalog stream opens when the atom is observed and closes when released.
   */
  readonly catalog: (connectionId: string) => Atom.Atom<Observation<Catalog>>;

  /**
   * Connects a host and adds it to `connections` on success.
   */
  readonly connect: (
    input: ConnectInput,
  ) => Effect.Effect<Connection, Transport.RequestError>;

  /**
   * Rediscovers hosts and replaces the current connection list.
   */
  readonly refresh: Effect.Effect<void, Transport.RequestError>;
}
const empty: Catalog = { ready: false, notebooks: {} };
function reduce(state: Catalog, event: CatalogEvent): Catalog {
  switch (event.event) {
    case "reset":
      return empty;
    case "ready":
      return { ...state, ready: true };
    case "notebook":
      return {
        ...state,
        notebooks: {
          ...state.notebooks,
          [event.data.notebook.id]: event.data.notebook,
        },
      };
    case "notebook.removed": {
      const notebooks = { ...state.notebooks };
      delete notebooks[event.data.id];
      return { ...state, notebooks };
    }
    default:
      return state;
  }
}

/**
 * Authenticates a workspace and starts discovering hosts.
 *
 * Pass the launch key from the proxy's terminal link to establish a session.
 * Omit it to reuse an existing session cookie. Closing the scope aborts requests
 * and catalog streams. Read workspace atoms with the registry supplied here.
 *
 * @example Observe hosts through a runtime atom
 * ```ts
 * import { Atom } from "effect/reactivity";
 * import * as Model from "@momo/model";
 * import * as Workspace from "@momo/model/Workspace";
 *
 * const runtime = Atom.runtime(Model.layer(window.location.origin));
 * const workspace = runtime.atom(Workspace.make());
 * ```
 */
export const make = (options: { launchKey?: string } = {}) =>
  Effect.gen(function* () {
    const transport = yield* Transport.Service;
    const registry = yield* AtomRegistry.AtomRegistry;
    const lifetime = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    );
    yield* transport.json(
      "/api/session",
      Schema.Struct({ authenticated: Schema.Literal(true) }),
      {
        signal: lifetime.signal,
        ...(options.launchKey
          ? {
              method: "POST",
              headers: { Authorization: `Bearer ${options.launchKey}` },
            }
          : {}),
      },
    );
    const connections = Atom.make<readonly Connection[]>([]);
    const status = Atom.make<Status>({ pending: false, error: null });
    yield* Effect.acquireRelease(
      Effect.sync(() => [registry.mount(connections), registry.mount(status)]),
      (unmount) => Effect.sync(() => unmount.forEach((close) => close())),
    );
    const lock = yield* Semaphore.make(1);
    const update = <A>(operation: Effect.Effect<A, Transport.RequestError>) =>
      lock.withPermit(
        Effect.gen(function* () {
          registry.set(status, { pending: true, error: null });
          return yield* operation.pipe(
            Effect.tapError((error) =>
              Effect.sync(() => registry.set(status, { pending: false, error })),
            ),
            Effect.ensuring(
              Effect.sync(() =>
                registry.update(status, (state) => ({ ...state, pending: false })),
              ),
            ),
          );
        }),
      );
    const refresh = update(
      transport
        .json("/api/hosts", Schema.Array(Connection), { signal: lifetime.signal })
        .pipe(
          Effect.tap((found) => Effect.sync(() => registry.set(connections, found))),
          Effect.asVoid,
        ),
    );
    const catalogs = new Map<string, Atom.Atom<Observation<Catalog>>>();
    const workspace: Workspace = {
      connections,
      status,
      refresh,
      connect: (input) =>
        update(
          transport
            .json("/api/hosts", Connection, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
              signal: lifetime.signal,
            })
            .pipe(
              Effect.tap((connection) =>
                Effect.sync(() =>
                  registry.update(connections, (current) => [
                    ...current.filter((item) => item.id !== connection.id),
                    connection,
                  ]),
                ),
              ),
            ),
        ),
      catalog: (connectionId) => {
        let catalog = catalogs.get(connectionId);
        if (!catalog) {
          catalog = observe({
            registry,
            signal: lifetime.signal,
            initial: empty,
            reduce,
            resume: (state) => ({ ...state, ready: false }),
            open: (onStatus) =>
              transport
                .client(connectionId, lifetime.signal)
                .events({ types: ["notebook"], onStatus, signal: lifetime.signal }),
          });
          catalogs.set(connectionId, catalog);
        }
        return catalog;
      },
    };
    yield* Effect.forkScoped(refresh.pipe(Effect.catch(() => Effect.void)));
    return workspace;
  });
