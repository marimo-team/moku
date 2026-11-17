/** Connect to a marimo host and acquire notebook observations. @module */
import {
  Effect,
  RcMap,
  Option,
  Schema,
  type Scope,
  type Redacted,
  type Duration,
} from "effect";
import { HttpClient } from "effect/http";
import { AtomRegistry, type AsyncResult, type Atom } from "effect/reactivity";
import type { CatalogEvent } from "./internal/api.ts";
import * as Protocol from "./Protocol.ts";
import type * as Notebook from "./Notebook.ts";
import { makeClient, makeCommands, ModelError } from "./internal/client.ts";
import * as NotebookModel from "./notebook/make.ts";
import { observe } from "./internal/observe.ts";

/** Host capabilities and catalog records indexed by ID. */
export interface State {
  /** Host-wide capabilities, or null before the host record arrives. */
  readonly host: typeof Protocol.Host.Type | null;
  /** Projects known to the host, including their discovery status. */
  readonly projects: Readonly<Record<string, typeof Protocol.Project.Type>>;
  /** Notebooks known to the host, indexed by ID. */
  readonly notebooks: Readonly<Record<string, typeof Protocol.Notebook.Type>>;
  /** Attached runtimes indexed by ID. */
  readonly runtimes: Readonly<Record<string, typeof Protocol.Runtime.Type>>;
  /** Runtime attachments indexed by ID. */
  readonly attachments: Readonly<Record<string, typeof Protocol.Attachment.Type>>;
}
/** Host connection settings. */
export interface Options {
  /** The host protocol API base URL, including its versioned path. */
  readonly baseUrl: string | URL;
  /** Bearer token sent to the host protocol API, including its event streams. */
  readonly token?: Redacted.Redacted<string>;
  /**
   * Base URL for widget requests when the notebook lacks the experimental comm operation.
   *
   * The launcher supplies its output proxy here. The injected HTTP client
   * posts to `/auth` before opening `/sse` and sending requests to `/api/kernel`.
   */
  readonly marimoBaseUrl?: URL;
  /** Maximum retry interval after an uncertain response. Defaults to 60 seconds; use a value shorter than the host's documented retention window. */
  readonly retryWindow?: Duration.Input;
}
/** A scoped host catalog and notebook operations. */
export interface Interface {
  /** Synchronized catalog state in the registry that acquired this host. */
  readonly state: Atom.Atom<AsyncResult.AsyncResult<State, Notebook.Error>>;
  /**
   * Restarts catalog and attached notebook streams after credentials or connectivity change.
   *
   * Handles and their state atoms retain their identity. Existing snapshots remain
   * available while new snapshots arrive; commands and local editor drafts stay alive.
   */
  readonly reconnect: Effect.Effect<void, Notebook.Error>;
  /** Notebook discovery and lifecycle operations. */
  readonly notebooks: {
    /** Shares a notebook while caller scopes hold it; the host scope bounds its lifetime. */
    readonly attach: (
      id: string,
    ) => Effect.Effect<
      Notebook.Interface,
      Schema.SchemaError | ModelError,
      Scope.Scope
    >;
    /** Creates a notebook in the specified project. */
    readonly create: (
      input: typeof Protocol.CreateNotebookRequest.Type,
    ) => Effect.Effect<typeof Protocol.Notebook.Type, Notebook.CommandError>;
    /** Changes a notebook's name or path. */
    readonly update: (
      id: string,
      input: typeof Protocol.UpdateNotebookRequest.Type,
    ) => Effect.Effect<typeof Protocol.Notebook.Type, Notebook.CommandError>;
    /** Deletes a notebook from its host. */
    readonly delete: (id: string) => Effect.Effect<void, Notebook.CommandError>;
    /** Opens the notebook in the host's own interface. */
    readonly open: (
      id: string,
    ) => Effect.Effect<
      typeof Protocol.OpenNotebookResponse.Type,
      Notebook.CommandError
    >;
  };
}
const empty = (): State => ({
  host: null,
  projects: {},
  notebooks: {},
  runtimes: {},
  attachments: {},
});
function without<A>(records: Readonly<Record<string, A>>, id: string) {
  const next = { ...records };
  delete next[id];
  return next;
}
function reduce(state: State, event: typeof CatalogEvent.Type): State {
  if ("_tag" in event) return state;
  switch (event.event) {
    case "reset":
      return empty();
    case "host":
      return { ...state, host: event.data.host };
    case "project":
      return {
        ...state,
        projects: { ...state.projects, [event.data.project.id]: event.data.project },
      };
    case "notebook":
      return {
        ...state,
        notebooks: {
          ...state.notebooks,
          [event.data.notebook.id]: event.data.notebook,
        },
      };
    case "runtime":
      return {
        ...state,
        runtimes: { ...state.runtimes, [event.data.runtime.id]: event.data.runtime },
      };
    case "attachment":
      return {
        ...state,
        attachments: {
          ...state.attachments,
          [event.data.attachment.id]: event.data.attachment,
        },
      };
    case "project.removed":
      return { ...state, projects: without(state.projects, event.data.id) };
    case "notebook.removed":
      return {
        ...state,
        notebooks: without(state.notebooks, event.data.id),
        runtimes: Object.fromEntries(
          Object.entries(state.runtimes).filter(
            ([, value]) => value.notebook_id !== event.data.id,
          ),
        ),
        attachments: Object.fromEntries(
          Object.entries(state.attachments).filter(
            ([, value]) => value.notebook_id !== event.data.id,
          ),
        ),
      };
    case "runtime.removed":
      return { ...state, runtimes: without(state.runtimes, event.data.id) };
    case "attachment.removed":
      return { ...state, attachments: without(state.attachments, event.data.id) };
    default:
      return state;
  }
}
/**
 * Acquires a host using the injected HTTP transport and atom registry.
 *
 * Closing the scope stops observation and interrupts commands and attachments.
 * Failed mutations retain their request identity within retryWindow. Successful
 * executions and definitive host rejections release that identity for new work.
 */
export const make = Effect.fnUntraced(function* (
  options: Options,
): Effect.fn.Return<
  Interface,
  never,
  HttpClient.HttpClient | AtomRegistry.AtomRegistry | Scope.Scope
> {
  const http = yield* HttpClient.HttpClient;
  const client = yield* makeClient(options);
  const registry = yield* AtomRegistry.AtomRegistry;
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }),
  );
  const commands = yield* makeCommands(options.retryWindow);
  const observation = yield* observe({
    initial: empty,
    reduce,
    resume: (state) => state,
    value: (state) => state,
    open: (cursor) =>
      client.Host.events({
        query: {},
        headers: cursor === undefined ? {} : { cursor },
      }),
  });
  const notebooks = yield* RcMap.make({
    lookup: (id: string) =>
      NotebookModel.make(
        client,
        id,
        options.retryWindow,
        options.marimoBaseUrl && {
          baseUrl: options.marimoBaseUrl,
          catalog: observation.state,
        },
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provideService(AtomRegistry.AtomRegistry, registry),
      ),
  });
  const params = (id: string) =>
    Schema.decodeUnknownEffect(Protocol.NotebookId)(id).pipe(
      Effect.map((notebookId) => ({ notebookId })),
    );
  return {
    state: observation.state,
    reconnect: commands.owned(
      Effect.scoped(
        Effect.gen(function* () {
          yield* observation.reconnect;
          for (const id of yield* RcMap.keys(notebooks)) {
            const attached = yield* RcMap.getOption(notebooks, id);
            if (Option.isSome(attached)) yield* attached.value.reconnect;
          }
        }),
      ),
    ),
    notebooks: {
      attach: Effect.fnUntraced(function* (id: string) {
        if (closed)
          return yield* Effect.fail(
            new ModelError({ reason: "closed", message: "The host is closed." }),
          );
        return (yield* RcMap.get(notebooks, id)).notebook;
      }),
      create: (input) => {
        const payload = structuredClone(input);
        return commands.mutation((idempotencyKey) =>
          client.Host.create({ payload, headers: { idempotencyKey } }),
        );
      },
      update: (id, input) => {
        const payload = structuredClone(input);
        return commands.mutation((idempotencyKey) =>
          params(id).pipe(
            Effect.flatMap((params) =>
              client.Notebook.update({ params, payload, headers: { idempotencyKey } }),
            ),
          ),
        );
      },
      delete: (id) =>
        commands.mutation((idempotencyKey) =>
          params(id).pipe(
            Effect.flatMap((params) =>
              client.Notebook.delete({ params, headers: { idempotencyKey } }),
            ),
            Effect.asVoid,
          ),
        ),
      open: (id) =>
        commands.mutation((idempotencyKey) =>
          params(id).pipe(
            Effect.flatMap((params) =>
              client.Notebook.open({ params, headers: { idempotencyKey } }),
            ),
          ),
        ),
    },
  };
});
