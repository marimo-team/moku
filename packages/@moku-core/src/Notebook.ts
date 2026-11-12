/**
 * Live notebook state and commands, owned by an Effect scope.
 *
 * Use {@link make} to acquire an instance or {@link layer} to provide it as
 * {@link Service}. Views can share the same instance.
 *
 * @module
 */
import { Context, Effect, Layer, type Scope } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type * as Runtime from "./Runtime.ts";
import * as Interactions from "./internal/interactions.ts";
import type * as Protocol from "./Protocol.ts";
import * as Transport from "./internal/transport.ts";
import { observe, type Observation } from "./internal/observe.ts";
import { emptyNotebook, reduceNotebook, type NotebookState } from "./notebook/state.ts";
import type { Confirmed } from "./notebook/confirmed.ts";

export type { Confirmed };

/**
 * Observed notebook records, including runtime activity and execution results.
 */
export type Snapshot = Readonly<Omit<NotebookState, "confirmed">>;

/**
 * Identifies a notebook through a host connection.
 *
 * `connectionId` identifies the proxy's connection to a host. `notebookId`
 * identifies the notebook on that host.
 */
export interface Target {
  readonly connectionId: string;
  readonly notebookId: string;
}

/**
 * The latest complete document revision and its current edit availability.
 */
export interface Source {
  /**
   * Null until a complete document revision has arrived.
   */
  readonly document: Confirmed | null;
  readonly canEdit: boolean;
}
/**
 * Notebook records, confirmed source, and observation progress.
 */
export interface State extends Observation<Snapshot> {
  readonly source: Source;
}

export interface RequestOptions {
  /**
   * An idempotency key for one logical request.
   *
   * Use a fresh ID for a new operation. Reuse it only when retrying that same
   * request with the same payload.
   */
  readonly requestId: string;
}

export interface EditOptions extends RequestOptions {
  readonly request: Protocol.EditRequest;
}

export interface SaveOptions extends RequestOptions {
  /**
   * The confirmed document revision to save; sent as an If-Match precondition.
   */
  readonly etag: string;

  /**
   * Choices supplied in response to a host decision request.
   */
  readonly decisions?: Record<string, string>;
}

/**
 * A notebook observation and commands bound to one host connection.
 */
export interface Interface {
  readonly target: Target;

  /**
   * Read-only records, source, connection status, and any observation error.
   */
  readonly state: Atom.Atom<State>;

  /**
   * Submits versioned document changes to the host.
   */
  readonly edit: (
    options: EditOptions,
  ) => Effect.Effect<Protocol.EditResponseOutput, Transport.RequestError>;

  /**
   * Saves the specified confirmed revision to disk.
   */
  readonly save: (
    options: SaveOptions,
  ) => Effect.Effect<Protocol.EditResponseOutput, Transport.RequestError>;

  /**
   * Execution commands and native output interactions for this notebook.
   */
  readonly runtime: Runtime.Interface;
}

/**
 * The current notebook supplied to an Effect program.
 */
export class Service extends Context.Service<Service, Interface>()("@moku/Notebook") {}

/**
 * Acquires a notebook observation and its commands.
 *
 * Read its atoms with the AtomRegistry supplied to this Effect. Closing the
 * scope stops observation and aborts in-flight requests. Connection failures
 * are reported through `state`.
 *
 * @example Acquire a notebook through a runtime atom
 * ```ts
 * import { Atom } from "effect/reactivity";
 * import * as Model from "@moku/core";
 * import * as Notebook from "@moku/core/Notebook";
 *
 * const runtime = Atom.runtime(Model.layer(window.location.origin));
 * const openNotebook = (target: Notebook.Target) =>
 *   runtime.atom(Notebook.make(target));
 * ```
 */
export function make(
  input: Target,
): Effect.Effect<
  Interface,
  never,
  Transport.Service | AtomRegistry.AtomRegistry | Scope.Scope
> {
  return Effect.gen(function* () {
    const transport = yield* Transport.Service;
    const registry = yield* AtomRegistry.AtomRegistry;
    const target = Object.freeze({ ...input });
    const lifetime = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    );
    const notebook = transport
      .client(target.connectionId, lifetime.signal)
      .notebook(target.notebookId);
    const observed = observe({
      registry,
      signal: lifetime.signal,
      initial: emptyNotebook(),
      reduce: (state, event: Protocol.EventOutput) => {
        if ("notebook" in event.data && event.data.notebook.id !== target.notebookId)
          throw new Error("Notebook stream changed identity");
        for (const record of Object.values(event.data)) {
          if (
            typeof record === "object" &&
            record !== null &&
            "notebook_id" in record &&
            record.notebook_id !== target.notebookId
          )
            throw new Error("Notebook stream changed identity");
        }
        return reduceNotebook(state, event);
      },
      resume: (state) =>
        state.phase === "snapshot"
          ? emptyNotebook()
          : { ...state, phase: "replay" as const, ready: false },
      open: (onStatus) =>
        notebook.events({
          types: [
            "notebook",
            "document",
            "cell",
            "analysis",
            "runtime",
            "run",
            "execution",
            "console",
            "display",
            "variable",
            "input",
          ],
          onStatus,
          signal: lifetime.signal,
        }),
    });
    yield* Atom.mount(observed);
    const state = Atom.readable((get): State => {
      const observation = get(observed);
      const { confirmed, ...value } = observation.value;
      return {
        ...observation,
        value,
        source: {
          document: confirmed.current,
          canEdit:
            observation.status === "connected" &&
            value.phase === "live" &&
            confirmed.current !== null &&
            value.notebook?.operations.includes("notebook.edit") === true,
        },
      };
    });
    const interactions = yield* Interactions.make(target, state);
    return Service.of({
      target,
      state,
      edit: ({ request, requestId }) =>
        Transport.mutation((signal) =>
          notebook.edit(request.changes, { signal, idempotencyKey: requestId }),
        ),
      save: ({ etag, requestId, decisions }) =>
        Transport.mutation((signal) =>
          notebook.save({
            ifMatch: etag,
            idempotencyKey: requestId,
            decisions,
            signal,
          }),
        ),
      runtime: {
        ...interactions,
        start: ({ requestId, decisions }) =>
          Transport.mutation((signal) =>
            notebook.start({ idempotencyKey: requestId, decisions, signal }),
          ),
        run: ({ request, requestId }) =>
          Transport.mutation((signal) =>
            notebook.run({ ...request, idempotencyKey: requestId, signal }),
          ),
        interrupt: ({ requestId }) =>
          Transport.mutation((signal) =>
            notebook.interrupt({ idempotencyKey: requestId, signal }),
          ),
        cancel: ({ runId, requestId }) =>
          Transport.mutation((signal) =>
            notebook.cancel({ runId, idempotencyKey: requestId, signal }),
          ),
        stop: ({ requestId }) =>
          Transport.mutation((signal) =>
            notebook.stop({ idempotencyKey: requestId, signal }),
          ),
      },
    });
  });
}

/**
 * Acquires a notebook and provides it as {@link Service} for the layer scope.
 */
export const layer = (target: Target) => Layer.effect(Service, make(target));
