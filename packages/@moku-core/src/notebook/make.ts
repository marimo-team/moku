/** Acquire notebook state and commands from a native host-protocol client. @module */
import { Effect, Queue, Schema, type Duration } from "effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import * as Protocol from "../Protocol.ts";
import type * as Notebook from "../Notebook.ts";
import { makeCommands, ModelError, type Client } from "../internal/client.ts";
import { observe } from "../internal/observe.ts";
import { emptyNotebook, reduceNotebook } from "./state.ts";
import * as Edit from "./edit.ts";
import type { NotebookEvent } from "../internal/api.ts";

export const make = Effect.fnUntraced(function* (
  client: Client,
  notebookId: string,
  retryWindow?: Duration.Input,
) {
  const id = yield* Schema.decodeUnknownEffect(Protocol.NotebookId)(notebookId);
  const params = { notebookId: id };
  const registry = yield* AtomRegistry.AtomRegistry;
  const commands = yield* makeCommands(retryWindow);
  const reserved = new Set<string>();
  let previous: ReturnType<typeof emptyNotebook>["confirmed"]["current"] = null;
  let document: Notebook.Document | null = null;
  const state = yield* observe({
    initial: emptyNotebook,
    reduce: (state, event: typeof NotebookEvent.Type) => {
      if ("_tag" in event) return state;
      if (event.event === "notebook" && event.data.notebook.id !== id)
        throw new Error("Notebook identity changed.");
      for (const record of Object.values(event.data)) {
        if (
          typeof record === "object" &&
          record !== null &&
          "notebook_id" in record &&
          record.notebook_id !== id
        )
          throw new Error("Record belongs to another notebook.");
      }
      if (event.event === "cell") reserved.add(event.data.cell.id);
      return reduceNotebook(state, event);
    },
    resume: (state) => ({ ...state, phase: "replay" as const, ready: false }),
    value: (state): Notebook.State => {
      const {
        confirmed,
        phase: _phase,
        ready: _ready,
        cells: _cells,
        document: _document,
        ...records
      } = state;
      const confirmedDocument = confirmed.current;
      if (previous !== confirmedDocument) {
        previous = confirmedDocument;
        document =
          confirmedDocument === null
            ? null
            : {
                ...confirmedDocument.revision,
                cells: confirmedDocument.revision.order.map((id) => {
                  const cell = confirmedDocument.cells.get(id);
                  if (!cell) throw new Error("The document is incomplete.");
                  return cell;
                }),
              };
      }
      return {
        ...records,
        document,
        analysis:
          document && records.analysis?.document_etag === document.etag
            ? records.analysis
            : null,
      };
    },
    open: (cursor) =>
      client.Notebook.events({
        params,
        query: {},
        headers: cursor === undefined ? {} : { cursor },
      }),
  });
  const runtime: Notebook.Runtime = {
    start: (payload = {}) =>
      commands.mutation((idempotencyKey) =>
        client.Notebook.start({
          params,
          payload: structuredClone(payload),
          headers: { idempotencyKey },
        }).pipe(Effect.map((response) => response.body)),
      ),
    restart: () =>
      commands.mutation((idempotencyKey) =>
        client.Notebook.restart({ params, headers: { idempotencyKey } }),
      ),
    stop: () =>
      commands.mutation((idempotencyKey) =>
        client.Notebook.stop({ params, headers: { idempotencyKey } }),
      ),
    interrupt: () =>
      commands.mutation((idempotencyKey) =>
        client.Notebook.interrupt({ params, headers: { idempotencyKey } }),
      ),
    run: ({ cells }) =>
      commands.mutation<Protocol.RunOutput, Notebook.CommandError>((idempotencyKey) =>
        cells.some((cell) => cell.notebook_id !== id)
          ? Effect.fail(
              new ModelError({
                reason: "invalid-edit",
                message: "A cell belongs to another notebook.",
              }),
            )
          : client.Notebook.run({
              params,
              payload: { cells: cells.map(({ id, etag }) => ({ id, etag })) },
              headers: { idempotencyKey },
            }),
      ),
    execute: (payload) =>
      commands.mutation((idempotencyKey) =>
        client.Notebook.execute({
          params,
          payload: structuredClone(payload),
          headers: { idempotencyKey },
        }),
      ),
    cancel: ({ runId }) =>
      commands.mutation((idempotencyKey) =>
        Schema.decodeUnknownEffect(Protocol.RunId)(runId).pipe(
          Effect.flatMap((runId) =>
            client.Notebook.cancel({
              params: { ...params, runId },
              headers: { idempotencyKey },
            }),
          ),
        ),
      ),
    reply: ({ inputId, value }) =>
      commands.mutation((idempotencyKey) =>
        Schema.decodeUnknownEffect(Protocol.ItemId)(inputId).pipe(
          Effect.flatMap((inputId) =>
            client.Notebook.reply({
              params: { ...params, inputId },
              payload: { value },
              headers: { idempotencyKey },
            }),
          ),
        ),
      ),
  };
  const ensureRunning = commands.owned(
    Effect.gen(function* () {
      const observations =
        yield* Queue.unbounded<
          AsyncResult.AsyncResult<Notebook.State, Notebook.Error>
        >();
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          registry.subscribe(
            state,
            (value) => {
              Queue.offerUnsafe(observations, value);
            },
            { immediate: true },
          ),
        ),
        (stop) => Effect.sync(stop),
      );
      let initial: AsyncResult.AsyncResult<Notebook.State, Notebook.Error> =
        registry.get(state);
      while (initial.waiting && !AsyncResult.isInitial(initial))
        initial = yield* Queue.take(observations);
      if (AsyncResult.isFailure(initial) && !initial.waiting)
        return yield* Effect.failCause(initial.cause);
      const current = AsyncResult.getOrElse(initial, () => undefined)?.runtime;
      if (current?.status === "running") return;
      const started = current?.status === "starting" ? current : yield* runtime.start();
      let latest = started;
      let seen = false;
      while (true) {
        const pending = yield* Queue.takeN(
          observations,
          Queue.sizeUnsafe(observations),
        );
        for (const value of pending) {
          if (AsyncResult.isFailure(value) && !value.waiting)
            return yield* Effect.failCause(value.cause);
          if (!AsyncResult.isSuccess(value) || value.waiting) continue;
          const observed = value.value.runtime;
          if (observed?.id === started.id) {
            seen = true;
            if (observed.status !== "starting" || latest.status === "starting")
              latest = observed;
          } else if (seen)
            return yield* Effect.fail(
              new ModelError({
                reason: "runtime-stopped",
                message: "The runtime stopped during startup.",
              }),
            );
        }
        if (latest.status === "running") return;
        if (latest.status !== "starting")
          return yield* Effect.fail(
            new ModelError({
              reason: "runtime-stopped",
              message: latest.message ?? "The runtime stopped during startup.",
            }),
          );
        const next = yield* Queue.take(observations);
        Queue.offerUnsafe(observations, next);
      }
    }).pipe(Effect.scoped, Effect.timeout("60 seconds")),
  );
  return {
    id,
    state,
    runtime,
    ensureRunning,
    edit: (callback) =>
      commands.mutation((idempotencyKey) => {
        let payload: Protocol.EditRequest | undefined;
        return Effect.try({
          try: () => (payload ??= Edit.build(id, reserved, callback)),
          catch: (cause) =>
            cause instanceof ModelError
              ? cause
              : new ModelError({ reason: "invalid-edit", message: String(cause) }),
        }).pipe(
          Effect.flatMap((payload) =>
            client.Notebook.edit({ params, payload, headers: { idempotencyKey } }),
          ),
          Effect.map(Edit.result),
        );
      }),
    save: (document, payload = {}) =>
      commands.mutation<Notebook.EditResult, Notebook.CommandError>((idempotencyKey) =>
        document.notebook_id !== id
          ? Effect.fail(
              new ModelError({
                reason: "invalid-edit",
                message: "The document belongs to another notebook.",
              }),
            )
          : client.Notebook.save({
              params,
              payload: structuredClone(payload),
              headers: { idempotencyKey, expectedEtag: document.etag },
            }).pipe(Effect.map(Edit.result)),
      ),
  } satisfies Notebook.Interface;
});
