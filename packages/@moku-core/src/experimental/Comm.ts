/**
 * Keep widget state for outputs that mount after their cells have run.
 *
 * TODO: Remove this module once outputs can read current widget state directly
 * from the notebook runtime. Today the renderer replays saved UI values and
 * widget models, then follows live updates from the same runtime.
 *
 * @module
 */
import {
  Cause,
  Data,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Queue,
  Schema,
  Scope,
  Stream,
} from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type * as Events from "../notebook/events.ts";
import * as CommProtocol from "../internal/comm-protocol.ts";
import type { Client, CommRequest } from "../internal/client.ts";
import type * as Notebook from "../Notebook.ts";
import * as Protocol from "../Protocol.ts";

type Json = typeof Schema.Json.Type;
/** Output notifications and the resets that invalidate previously received state. */
type Event =
  | {
      /** Discards UI values and widget models from the preceding connection. */
      readonly kind: "reset";
      /** The selected runtime, or null when no connection is held. */
      readonly runtimeId: string | null;
    }
  | {
      /** Delivers a message from the selected runtime. */
      readonly kind: "notification";
      /** The runtime that produced this message. */
      readonly runtimeId: string;
      /** The mutation that caused the notification, when the host identified it. */
      readonly requestId?: string;
      /** The decoded message for the output renderer. */
      readonly notification: CommProtocol.Notification;
    };

/** A widget request or its notebook connection failed. */
export class CommError extends Data.TaggedError("CommError")<{
  readonly code:
    | "unavailable"
    | "stale-runtime"
    | "authentication"
    | "unsupported"
    | "rpc"
    | "transport"
    | "timeout"
    | "closed";
  readonly message: string;
  readonly cause?: unknown;
}> {}

interface Target {
  /** Pass the ID that produced the output to reject a stale callback. Omit it to use the current runtime. */
  readonly runtimeId?: string;
}
type Payload = CommRequest["payload"];
type Message = Target & Exclude<Payload, { _tag: "Invoke" }>;
type Invoke = Target & Omit<Extract<Payload, { _tag: "Invoke" }>, "_tag">;
type Connection = Data.TaggedEnum<{
  /** No output attachment is active, including when no runtime is running. */
  Idle: {};
  /** Opening the session stream and confirming its runtime. */
  Connecting: {};
  /** The notebook is delivering widget notifications. */
  Connected: {};
  /** The notebook stream or its widget session failed. */
  Failed: {
    /** The failure to display while awaiting retry or a runtime change. */
    readonly error: CommError;
  };
}>;
const Connection = Data.taggedEnum<Connection>();

/**
 * Widget state and actions for an attached notebook.
 *
 * Closing the notebook ends subscriptions and cancels pending calls.
 */
export interface Interface {
  /** Reports the widget connection status. Reading it does not open a session. */
  readonly connection: Atom.Atom<Connection>;
  /**
   * Restores the renderer’s current widget state and delivers subsequent updates.
   *
   * A reset tells the renderer to discard its widget registrations. Each new
   * reader then receives the saved UI values and open models for the runtime.
   * Custom messages and function replies are delivered only to live readers.
   */
  readonly events: Stream.Stream<Event>;
  /**
   * Sends a UI value or widget message and completes when the server accepts it.
   *
   * Kernel updates arrive on {@link Interface.events}. A failed request may
   * already have reached the kernel, so sends are attempted once. Pass a fresh
   * idempotency key to recognize your write on the event stream.
   */
  readonly send: (
    message: Message,
    idempotencyKey: string,
  ) => Effect.Effect<void, CommError>;
  /**
   * Calls a registered Python function and returns its result.
   *
   * The caller supplies a fresh call ID for each invocation. It is sent as the
   * idempotency key and identifies the kernel reply on the notebook stream.
   *
   * The 30-second timeout includes connecting and waiting for the kernel’s
   * reply. Restarting the runtime fails calls that are still waiting.
   */
  readonly invoke: (options: Invoke) => Effect.Effect<Json, CommError>;
  /** Requests a reconnect. Observe {@link Interface.connection} for its status. */
  readonly retry: Effect.Effect<void>;
}

interface Observation {
  readonly state: Notebook.Interface["state"];
  readonly events: Stream.Stream<Events.Update>;
  readonly reconnect: Effect.Effect<void>;
  readonly id: typeof Protocol.NotebookId.Type;
  readonly client: Client["Comm"];
  readonly viewer?: Events.Session | undefined;
}

const problem = (code: CommError["code"], message: string) =>
  new CommError({ code, message });

type PendingCalls = Map<string, Deferred.Deferred<Json, CommError>>;

function replyToCall(calls: PendingCalls, notification: CommProtocol.Notification) {
  if (notification.op !== "function-call-result") return;
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

const callPython = Effect.fnUntraced(function* (
  calls: PendingCalls,
  call: string,
  send: Effect.Effect<void, CommError>,
) {
  const reply = yield* Deferred.make<Json, CommError>();
  if (calls.has(call))
    return yield* problem(
      "rpc",
      "A Python call with this request ID is already pending.",
    );
  calls.set(call, reply);
  return yield* send.pipe(
    Effect.andThen(Deferred.await(reply)),
    Effect.ensuring(Effect.sync(() => calls.delete(call))),
  );
});

interface Viewer {
  readonly sessionId: string;
  readonly ready: Deferred.Deferred<void>;
  readonly ended: Deferred.Deferred<never, CommError>;
  interact: boolean;
}

interface Runtime {
  readonly id: string;
  readonly hostComm: boolean;
  readonly scope: Scope.Closeable;
  readonly calls: PendingCalls;
  viewer?: Viewer;
}

/** Follow widget notifications on the attached notebook and send requests to its running kernel. */
export const make = Effect.fnUntraced(function* (notebook: Observation) {
  const registry = yield* AtomRegistry.AtomRegistry;
  const legacy = notebook.viewer;
  const owner = yield* Effect.scope;
  const snapshot = new CommProtocol.Snapshot();
  const readers = new Set<Queue.Queue<Event, Cause.Done>>();
  let active: Runtime | undefined;
  const channel = Atom.make<Connection>(Connection.Idle());
  yield* Atom.mount(channel);

  function emit(event: Event) {
    for (const reader of readers) Queue.offerUnsafe(reader, event);
  }
  const reset = Effect.gen(function* () {
    if (!active) return;
    const previous = active;
    active = undefined;
    snapshot.reset();
    registry.set(channel, Connection.Idle());
    emit({ kind: "reset", runtimeId: null });
    yield* Scope.close(previous.scope, Exit.void);
  }).pipe(Effect.uninterruptible);
  function deliver(runtime: Runtime, raw: unknown, requestId?: string) {
    const notification = snapshot.recordNotification(raw);
    if (!notification) return;
    replyToCall(runtime.calls, notification);
    emit({
      kind: "notification",
      runtimeId: runtime.id,
      notification,
      ...(requestId !== undefined && { requestId }),
    });
    return notification;
  }
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* reset;
      for (const queue of readers) Queue.endUnsafe(queue);
      readers.clear();
    }),
  );
  const events = Stream.callback<Event>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        if (owner.state._tag === "Closed") {
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

  const receive = Effect.fnUntraced(function* ({ state, event }: Events.Update) {
    // The viewer starts with its own notebook snapshot before confirming its runtime.
    if (!event) {
      if (!active?.viewer) yield* reset;
      return;
    }
    if ("_tag" in event) return;
    if (!state.runtime && state.phase === "snapshot" && event.event !== "reset") return;
    const hostComm =
      state.notebook?.operations.includes(CommProtocol.operation) ?? false;
    const id = state.runtime?.status === "running" ? state.runtime.id : undefined;
    if (id !== active?.id || (active && active.hostComm !== hostComm)) {
      yield* reset;
      if (id) {
        active = {
          id,
          hostComm,
          scope: yield* Scope.fork(owner),
          calls: new Map(),
        };
        registry.set(channel, Connection.Connected());
        deliver(active, { op: "kernel-ready", ui_values: {} });
      }
    }
    if (!active) return;
    if (event.event === "custom" && event.data.custom.type === "marimo.notification") {
      deliver(active, event.data.custom.data, event.data.request_id);
    } else if (!active.hostComm && event.event === "marimo") {
      const viewer = active.viewer;
      if (event.sessionId && viewer?.sessionId !== event.sessionId) return;
      const notification = deliver(active, event.data.marimo, event.data.request_id);
      if (!event.sessionId || !viewer) return;
      if (
        notification?.op === "kernel-ready" ||
        notification?.op === "consumer-capabilities"
      )
        viewer.interact = notification.consumer_capabilities?.interact === true;
      if (notification?.op === "kernel-ready") {
        registry.set(channel, Connection.Connected());
        Deferred.doneUnsafe(viewer.ready, Effect.void);
      }
    }
  });
  yield* notebook.events.pipe(Stream.runForEach(receive), Effect.forkScoped);

  const attach = Effect.fnUntraced(function* (
    current: Runtime,
    record: typeof Protocol.Notebook.Type,
    session: Events.Session,
  ) {
    if (current.viewer) return current.viewer;
    const viewer: Viewer = {
      sessionId: crypto.randomUUID(),
      ready: Deferred.makeUnsafe(),
      ended: Deferred.makeUnsafe(),
      interact: false,
    };
    current.viewer = viewer;
    registry.set(channel, Connection.Connecting());
    yield* session
      .open({ runtimeId: current.id, sessionId: viewer.sessionId }, record)
      .pipe(
        Effect.raceFirst(
          Deferred.await(viewer.ready).pipe(
            Effect.timeoutOrElse({
              duration: "10 seconds",
              orElse: () =>
                Effect.fail(
                  problem("timeout", "The output connection did not become ready."),
                ),
            }),
            Effect.andThen(Effect.never),
          ),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            Deferred.doneUnsafe(viewer.ended, Effect.fail(error));
            if (active === current && current.viewer === viewer)
              registry.set(channel, Connection.Failed({ error }));
          }),
        ),
        Effect.forkIn(current.scope),
      );
    return viewer;
  }, Effect.uninterruptible);

  const sendToHost = (id: string, command: CommRequest) =>
    notebook.client.send({ params: { notebookId: notebook.id }, ...command }).pipe(
      Effect.mapError(
        (cause) =>
          new CommError({
            code: "transport",
            message: "The host refused the comm request.",
            cause,
          }),
      ),
      Effect.flatMap((runtime) =>
        runtime.id === id && runtime.notebook_id === notebook.id
          ? Effect.void
          : Effect.fail(
              problem("stale-runtime", "The host answered for a different runtime."),
            ),
      ),
    );

  const runInRuntime = Effect.fnUntraced(function* <A>(
    runtime: Runtime,
    action: Effect.Effect<A, CommError>,
  ) {
    const exit = yield* Effect.acquireUseRelease(
      Effect.forkIn(action, runtime.scope),
      Fiber.await,
      Fiber.interrupt,
    );
    if (Exit.isFailure(exit)) {
      if (owner.state._tag === "Closed")
        return yield* problem("closed", "The notebook is closed.");
      if (runtime.scope.state._tag === "Closed")
        return yield* problem("stale-runtime", "The runtime changed.");
    }
    return yield* exit;
  });

  const request = Effect.fnUntraced(function* <A>(
    target: Target,
    command: CommRequest,
    perform: (
      send: Effect.Effect<void, CommError>,
      runtime: Runtime,
    ) => Effect.Effect<A, CommError>,
  ) {
    if (owner.state._tag === "Closed")
      return yield* problem("closed", "The notebook is closed.");
    const state = registry.get(notebook.state);
    const current = active;
    if (target.runtimeId !== undefined && current?.id !== target.runtimeId)
      return yield* problem(
        "stale-runtime",
        "This output belongs to an earlier runtime.",
      );
    if (
      !AsyncResult.isSuccess(state) ||
      !state.value.notebook ||
      (state.waiting && !current?.viewer)
    )
      return yield* problem("unavailable", "The notebook is reconnecting.");
    if (!legacy && !state.value.notebook.operations.includes(CommProtocol.operation))
      return yield* problem(
        "unsupported",
        "The notebook does not offer runtime.experimental.comm.",
      );
    if (
      !current ||
      current.id !== state.value.runtime?.id ||
      state.value.runtime.status !== "running" ||
      current.hostComm !==
        state.value.notebook.operations.includes(CommProtocol.operation)
    )
      return yield* problem(
        "unavailable",
        "Start the runtime to interact with outputs.",
      );

    const record = state.value.notebook;
    const action = Effect.gen(function* () {
      if (current.hostComm || !legacy)
        return yield* perform(sendToHost(current.id, command), current);
      const viewer = yield* attach(current, record, legacy);
      if (Deferred.isDoneUnsafe(viewer.ended))
        return yield* Deferred.await(viewer.ended);
      const send = Deferred.await(viewer.ready).pipe(
        Effect.andThen(() =>
          viewer.interact
            ? legacy.post(viewer.sessionId, command)
            : Effect.fail(
                problem(
                  "unsupported",
                  "The viewer does not permit output interactions.",
                ),
              ),
        ),
      );
      return yield* perform(send, current).pipe(
        Effect.raceFirst(Deferred.await(viewer.ended)),
      );
    }).pipe(
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () => Effect.fail(problem("timeout", "The comm request timed out.")),
      }),
    );
    return yield* runInRuntime(current, action);
  });
  return {
    connection: Atom.readable((get) => {
      const result = get(notebook.state);
      if (AsyncResult.isFailure(result) && !result.waiting)
        return Connection.Failed({
          error: problem("transport", "The notebook event stream failed."),
        });
      return result.waiting ? Connection.Connecting() : get(channel);
    }),
    events,
    retry: Effect.gen(function* () {
      if (!active?.viewer || registry.get(channel)._tag !== "Failed")
        return yield* notebook.reconnect;
      const state = registry.get(notebook.state);
      if (legacy && AsyncResult.isSuccess(state) && state.value.notebook) {
        delete active.viewer;
        yield* attach(active, state.value.notebook, legacy);
      }
    }),
    send: (message, idempotencyKey) =>
      request(
        message,
        { payload: message, headers: { idempotencyKey } },
        (send) => send,
      ),
    invoke: (input: Invoke) =>
      request(
        input,
        {
          payload: {
            _tag: "Invoke",
            call: input.call,
            name: input.name,
            namespace: input.namespace,
            args: input.args,
          },
          headers: { idempotencyKey: input.call },
        },
        (send, runtime) => callPython(runtime.calls, input.call, send),
      ),
  } satisfies Interface;
});
