/** Route notebook widget notifications and correlate calls to the producing runtime. @module */
import * as Native from "../internal/native-comm.ts";
import { type Cause, Deferred, Effect, Queue, Stream } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Comm from "../Comm.ts";
import type * as Notebook from "../Notebook.ts";
import type * as Protocol from "../Protocol.ts";
import type { Client } from "../internal/client.ts";
import type { NotebookState } from "./state.ts";

const problem = (code: Comm.Error["code"], message: string) =>
  new Comm.Error({ code, message });

export const make = Effect.fnUntraced(function* (
  client: Client,
  notebookId: typeof Protocol.NotebookId.Type,
) {
  const registry = yield* AtomRegistry.AtomRegistry;
  const snapshot = new Native.Snapshot();
  const readers = new Set<Queue.Queue<Comm.Event, Cause.Done>>();
  const calls = new Map<string, Deferred.Deferred<Comm.Json, Comm.Error>>();
  let active: { id: string; ended: Deferred.Deferred<never, Comm.Error> } | undefined;
  const channel = Atom.make<Comm.Connection>(Comm.Connection.Idle());
  yield* Atom.mount(channel);
  let closed = false;

  function emit(event: Comm.Event) {
    for (const reader of readers) Queue.offerUnsafe(reader, event);
  }
  function reset() {
    if (!active) return;
    Deferred.doneUnsafe(
      active.ended,
      Effect.fail(
        closed
          ? problem("closed", "The notebook is closed.")
          : problem("stale-runtime", "The runtime changed."),
      ),
    );
    active = undefined;
    calls.clear();
    snapshot.reset();
    registry.set(channel, Comm.Connection.Idle());
    emit({ kind: "reset", runtimeId: null });
  }
  function deliver(runtimeId: string, raw: unknown) {
    const notification = snapshot.recordNotification(raw);
    if (!notification) return;
    if (
      notification.op === "kernel-ready" ||
      notification.op === "consumer-capabilities"
    )
      registry.set(
        channel,
        Comm.Connection.Connected({
          canInteract: notification.consumer_capabilities?.interact === true,
        }),
      );
    if (notification.op === "function-call-result") {
      const reply = calls.get(notification.function_call_id);
      if (reply)
        Deferred.doneUnsafe(
          reply,
          notification.found && notification.status.code === "ok"
            ? Effect.succeed(notification.return_value)
            : Effect.fail(
                problem(
                  "rpc",
                  notification.status.message ??
                    notification.status.title ??
                    "The kernel function failed.",
                ),
              ),
        );
    }
    emit({ kind: "notification", runtimeId, notification });
  }
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      reset();
      for (const queue of readers) Queue.endUnsafe(queue);
      readers.clear();
    }),
  );
  const events = Stream.callback<Comm.Event>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        if (closed) {
          Queue.endUnsafe(queue);
          return;
        }
        readers.add(queue);
        Queue.offerUnsafe(queue, { kind: "reset", runtimeId: active?.id ?? null });
        if (active)
          for (const notification of snapshot.messages())
            Queue.offerUnsafe(queue, {
              kind: "notification",
              runtimeId: active.id,
              notification,
            });
      }),
      () =>
        Effect.sync(() => {
          readers.delete(queue);
        }),
    ),
  );

  return {
    reset,
    receive(state: NotebookState, event: Protocol.NotebookEvent) {
      const id =
        state.notebook?.operations.includes("runtime.comm") &&
        state.runtime?.status === "running"
          ? state.runtime.id
          : undefined;
      if (id !== active?.id) {
        reset();
        if (id) {
          active = { id, ended: Deferred.makeUnsafe() };
          deliver(id, {
            op: "kernel-ready",
            ui_values: {},
            consumer_capabilities: { edit: false, interact: true },
          });
        }
      }
      if (
        id &&
        event.event === "custom" &&
        event.data.custom.type === "marimo.notification"
      ) {
        deliver(id, event.data.custom.data);
      }
    },
    bind(
      observed: Notebook.Interface["state"],
      retry: Effect.Effect<void>,
    ): Comm.Interface {
      type Payload = Parameters<Client["Comm"]["send"]>[0]["payload"];
      const post = (id: string, payload: Payload) =>
        client.Comm.send({ params: { notebookId }, payload }).pipe(
          Effect.mapError(
            (cause) =>
              new Comm.Error({
                code: "transport",
                message: "The host refused the comm request.",
                cause,
              }),
          ),
          Effect.flatMap((runtime) =>
            runtime.id === id && runtime.notebook_id === notebookId
              ? Effect.void
              : Effect.fail(
                  problem(
                    "stale-runtime",
                    "The host answered for a different runtime.",
                  ),
                ),
          ),
        );
      const request = <A>(
        target: Comm.Target,
        run: (id: string) => Effect.Effect<A, Comm.Error>,
      ) =>
        Effect.suspend<A, Comm.Error, never>(() => {
          if (closed) return Effect.fail(problem("closed", "The notebook is closed."));
          if (target.runtimeId !== undefined && active?.id !== target.runtimeId)
            return Effect.fail(
              problem("stale-runtime", "This output belongs to an earlier runtime."),
            );
          const state = registry.get(observed);
          if (!AsyncResult.isSuccess(state) || state.waiting)
            return Effect.fail(problem("unavailable", "The notebook is reconnecting."));
          if (!state.value.notebook?.operations.includes("runtime.comm"))
            return Effect.fail(
              problem("unsupported", "The notebook does not offer runtime.comm."),
            );
          if (!active)
            return Effect.fail(
              problem("unavailable", "Start the runtime to interact with outputs."),
            );
          const connection = registry.get(channel);
          if (connection._tag !== "Connected" || !connection.canInteract)
            return Effect.fail(
              problem(
                "unsupported",
                "The runtime does not permit output interactions.",
              ),
            );
          return run(active.id).pipe(
            Effect.raceFirst(Deferred.await(active.ended)),
            Effect.timeoutOrElse({
              duration: "30 seconds",
              orElse: () =>
                Effect.fail(problem("timeout", "The comm request timed out.")),
            }),
          );
        });
      return {
        state: Atom.readable((get) => {
          const result = get(observed);
          const runtime =
            AsyncResult.getOrElse(result, () => undefined)?.runtime ?? null;
          if (AsyncResult.isFailure(result) && !result.waiting)
            return {
              runtime,
              connection: Comm.Connection.Failed({
                error: problem("transport", "The notebook event stream failed."),
              }),
            };
          return {
            runtime,
            connection: result.waiting ? Comm.Connection.Connecting() : get(channel),
          };
        }),
        events,
        retry,
        send: (message) =>
          request(message, (id) =>
            post(
              id,
              message._tag === "SetValues"
                ? { _tag: "SetValues", values: message.values }
                : {
                    _tag: "Model",
                    model: message.model,
                    message: message.message,
                    buffers: message.buffers,
                  },
            ),
          ),
        invoke: (input) =>
          request(input, (id) =>
            Effect.gen(function* () {
              const call = crypto.randomUUID();
              const reply = yield* Effect.acquireRelease(
                Effect.sync(() => {
                  const result = Deferred.makeUnsafe<Comm.Json, Comm.Error>();
                  calls.set(call, result);
                  return result;
                }),
                () =>
                  Effect.sync(() => {
                    calls.delete(call);
                  }),
              );
              yield* post(id, {
                _tag: "Invoke",
                call,
                namespace: input.namespace,
                name: input.name,
                args: input.args,
              });
              return yield* Deferred.await(reply);
            }).pipe(Effect.scoped),
          ),
      };
    },
  };
});
