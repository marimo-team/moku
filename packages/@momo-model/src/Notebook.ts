import { Context, Effect, Layer, type Scope } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type * as Protocol from "./Protocol.ts";
import * as Transport from "./internal/transport.ts";
import { observe, type Observation } from "./internal/observe.ts";
import { emptyNotebook, reduceNotebook, type NotebookState } from "./notebook/state.ts";
import type { Confirmed } from "./notebook/confirmed.ts";

export type { Confirmed };
export type Snapshot = Omit<NotebookState, "confirmed">;
export interface Target {
  readonly connectionId: string;
  readonly notebookId: string;
}
export interface Source {
  readonly document: Confirmed | null;
  readonly canEdit: boolean;
}
export interface RequestOptions {
  readonly requestId: string;
}

export interface EditOptions extends RequestOptions {
  readonly request: Protocol.EditRequest;
}

export interface SaveOptions extends RequestOptions {
  readonly etag: string;
  readonly decisions?: Record<string, string>;
}

export interface StartOptions extends RequestOptions {
  readonly decisions?: Record<string, string>;
}

export interface RunOptions extends RequestOptions {
  readonly request: Protocol.RunRequest;
}

export interface CancelOptions extends RequestOptions {
  readonly runId: string;
}

export interface Interface {
  readonly target: Target;
  readonly state: Atom.Atom<Observation<Snapshot>>;
  readonly source: Atom.Atom<Source>;
  readonly edit: (
    options: EditOptions,
  ) => Effect.Effect<Protocol.EditResponseOutput, Transport.RequestError>;
  readonly save: (
    options: SaveOptions,
  ) => Effect.Effect<Protocol.EditResponseOutput, Transport.RequestError>;
  readonly start: (
    options: StartOptions,
  ) => Effect.Effect<Protocol.RuntimeOutput, Transport.RequestError>;
  readonly run: (
    options: RunOptions,
  ) => Effect.Effect<Protocol.RunOutput, Transport.RequestError>;
  readonly interrupt: (
    options: RequestOptions,
  ) => Effect.Effect<Protocol.RuntimeOutput, Transport.RequestError>;
  readonly cancel: (
    options: CancelOptions,
  ) => Effect.Effect<Protocol.RunOutput, Transport.RequestError>;
  readonly stop: (
    options: RequestOptions,
  ) => Effect.Effect<Protocol.RuntimeOutput, Transport.RequestError>;
}

export class Service extends Context.Service<Service, Interface>()("@momo/Notebook") {}

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
    const state = observe({
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
    yield* Effect.acquireRelease(
      Effect.sync(() => registry.mount(state)),
      (unmount) => Effect.sync(unmount),
    );
    const source = Atom.make((get): Source => {
      const observation = get(state);
      return {
        document: observation.value.confirmed.current,
        canEdit:
          observation.status === "connected" &&
          observation.value.phase === "live" &&
          observation.value.confirmed.current !== null &&
          observation.value.notebook?.operations.includes("notebook.edit") === true,
      };
    });
    return Service.of({
      target,
      state,
      source,
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
    });
  });
}

export const layer = (target: Target) => Layer.effect(Service, make(target));
