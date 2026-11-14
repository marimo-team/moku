/** Connect to a marimo host and acquire notebook observations. @module */
import {
  Effect,
  RcMap,
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
  readonly host: Protocol.HostOutput | null;
  /** Projects known to the host, including their discovery status. */
  readonly projects: Readonly<Record<string, Protocol.ProjectOutput>>;
  /** Notebooks known to the host, indexed by ID. */
  readonly notebooks: Readonly<Record<string, Protocol.NotebookOutput>>;
  /** Attached runtimes indexed by ID. */
  readonly runtimes: Readonly<Record<string, Protocol.RuntimeOutput>>;
  /** Runtime attachments indexed by ID. */
  readonly attachments: Readonly<Record<string, Protocol.AttachmentOutput>>;
}
/** Host connection settings. */
export interface Options {
  /** The host protocol API base URL, including its versioned path. */
  readonly baseUrl: string | URL;
  /** Bearer credential supplied with requests to this host. */
  readonly token?: Redacted.Redacted<string>;
  /** Maximum retry interval after an uncertain response. Defaults to 60 seconds; use a value shorter than the host's documented retention window. */
  readonly retryWindow?: Duration.Input;
}
/** A scoped host catalog and notebook operations. */
export interface Interface {
  /** Synchronized catalog state in the registry that acquired this host. */
  readonly state: Atom.Atom<AsyncResult.AsyncResult<State, Notebook.Error>>;
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
    ) => Effect.Effect<Protocol.NotebookOutput, Notebook.CommandError>;
    /** Changes a notebook's name or path. */
    readonly update: (
      id: string,
      input: typeof Protocol.UpdateNotebookRequest.Type,
    ) => Effect.Effect<Protocol.NotebookOutput, Notebook.CommandError>;
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
  const client = yield* makeClient(options);
  const registry = yield* AtomRegistry.AtomRegistry;
  let closed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
    }),
  );
  const commands = yield* makeCommands(options.retryWindow);
  const notebooks = yield* RcMap.make({
    lookup: (id: string) =>
      NotebookModel.make(client, id, options.retryWindow).pipe(
        Effect.provideService(AtomRegistry.AtomRegistry, registry),
      ),
  });
  const state = yield* observe({
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
  const params = (id: string) =>
    Schema.decodeUnknownEffect(Protocol.NotebookId)(id).pipe(
      Effect.map((notebookId) => ({ notebookId })),
    );
  return {
    state,
    notebooks: {
      attach: Effect.fnUntraced(function* (id: string) {
        if (closed)
          return yield* Effect.fail(
            new ModelError({ reason: "closed", message: "The host is closed." }),
          );
        return yield* RcMap.get(notebooks, id);
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
