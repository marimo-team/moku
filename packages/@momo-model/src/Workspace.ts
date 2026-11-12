import { Effect, Schema, Semaphore } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type { CatalogEvent } from "@marimo-team/client";
import type * as Protocol from "./Protocol.ts";
import * as Transport from "./internal/transport.ts";
import { observe, type Observation } from "./internal/observe.ts";

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
export interface Catalog {
  readonly ready: boolean;
  readonly notebooks: Readonly<Record<string, Protocol.NotebookOutput>>;
}
export interface Status {
  readonly pending: boolean;
  readonly error: Transport.RequestError | null;
}
export interface Workspace {
  readonly connections: Atom.Atom<readonly Connection[]>;
  readonly status: Atom.Atom<Status>;
  readonly catalog: (connectionId: string) => Atom.Atom<Observation<Catalog>>;
  readonly connect: (
    input: ConnectInput,
  ) => Effect.Effect<Connection, Transport.RequestError>;
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
