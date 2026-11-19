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
  Queue,
  Schema,
  type Scope,
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
  Connected: {
    /** Whether widgets may attempt a write. A legacy viewer confirms permission on the first request. */
    readonly canInteract: boolean;
  };
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
  /** Reports connection status and whether widgets can send updates. Reading it does not open a session. */
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
  /** Requests a reconnect. Observe {@link Interface.connection} to see when widgets can interact again. */
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

interface Viewer {
  readonly sessionId: string;
  readonly ready: Deferred.Deferred<void>;
  readonly ended: Deferred.Deferred<never, CommError>;
}

interface Runtime {
  readonly id: string;
  readonly hostComm: boolean;
  readonly ended: Deferred.Deferred<never, CommError>;
  viewer?: Viewer;
}

/** Follow widget notifications on the attached notebook and send requests to its running kernel. */
export const make = Effect.fnUntraced(function* (notebook: Observation) {
  const registry = yield* AtomRegistry.AtomRegistry;
  const legacy = notebook.viewer;
  const viewerContext = yield* Effect.context<Scope.Scope>();
  const snapshot = new CommProtocol.Snapshot();
  const readers = new Set<Queue.Queue<Event, Cause.Done>>();
  const calls = new Map<string, Deferred.Deferred<Json, CommError>>();
  let active: Runtime | undefined;
  const channel = Atom.make<Connection>(Connection.Idle());
  yield* Atom.mount(channel);
  let closed = false;

  function emit(event: Event) {
    for (const reader of readers) Queue.offerUnsafe(reader, event);
  }
  function reset(reason = problem("stale-runtime", "The runtime changed.")) {
    if (!active) return;
    Deferred.doneUnsafe(active.ended, Effect.fail(reason));
    active = undefined;
    calls.clear();
    snapshot.reset();
    registry.set(channel, Connection.Idle());
    emit({ kind: "reset", runtimeId: null });
  }
  function deliver(
    runtimeId: string,
    raw: unknown,
    requestId?: string,
    updatePermissions = true,
  ) {
    const notification = snapshot.recordNotification(raw);
    if (!notification) return;
    if (
      updatePermissions &&
      (notification.op === "kernel-ready" ||
        notification.op === "consumer-capabilities")
    )
      registry.set(
        channel,
        Connection.Connected({
          canInteract: notification.consumer_capabilities?.interact === true,
        }),
      );
    replyToCall(calls, notification);
    emit({
      kind: "notification",
      runtimeId,
      notification,
      ...(requestId !== undefined && { requestId }),
    });
    return notification;
  }
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      reset(problem("closed", "The notebook is closed."));
      for (const queue of readers) Queue.endUnsafe(queue);
      readers.clear();
    }),
  );
  const events = Stream.callback<Event>((queue) =>
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

  function receive({ state, event }: Events.Update) {
    // The viewer starts with its own notebook snapshot before confirming its runtime.
    if (!event) {
      if (!active?.viewer) reset();
      return;
    }
    if ("_tag" in event) return;
    if (!state.runtime && state.phase === "snapshot" && event.event !== "reset") return;
    const hostComm =
      state.notebook?.operations.includes(CommProtocol.operation) ?? false;
    const id =
      state.runtime?.status === "running" && (hostComm || legacy)
        ? state.runtime.id
        : undefined;
    if (id !== active?.id || (active && active.hostComm !== hostComm)) {
      reset();
      if (id) {
        active = { id, hostComm, ended: Deferred.makeUnsafe() };
        deliver(id, {
          op: "kernel-ready",
          ui_values: {},
          consumer_capabilities: { edit: false, interact: true },
        });
      }
    }
    if (!active) return;
    if (active.hostComm) {
      if (event.event === "custom" && event.data.custom.type === "marimo.notification")
        deliver(active.id, event.data.custom.data, event.data.request_id);
    } else if (event.event === "marimo") {
      if (event.sessionId && active.viewer?.sessionId !== event.sessionId) return;
      const notification = deliver(
        active.id,
        event.data.marimo,
        event.data.request_id,
        !active.viewer || !!event.sessionId,
      );
      if (event.sessionId && active.viewer && notification?.op === "kernel-ready")
        Deferred.doneUnsafe(active.viewer.ready, Effect.void);
    }
  }
  yield* notebook.events.pipe(
    Stream.runForEach((update) => Effect.sync(() => receive(update))),
    Effect.forkScoped,
  );

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
        Effect.raceFirst(Deferred.await(current.ended)),
        Effect.catch((error) =>
          Effect.sync(() => {
            Deferred.doneUnsafe(viewer.ended, Effect.fail(error));
            if (active === current && current.viewer === viewer)
              registry.set(channel, Connection.Failed({ error }));
          }),
        ),
        Effect.forkScoped,
        Effect.setContext(viewerContext),
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

  const request = Effect.fnUntraced(function* <A>(
    target: Target,
    command: CommRequest,
    result: Effect.Effect<A, CommError>,
  ) {
    if (closed) return yield* problem("closed", "The notebook is closed.");
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

    const perform = (send: Effect.Effect<void, CommError>) =>
      Effect.suspend(() => {
        const connection = registry.get(channel);
        return connection._tag === "Connected" && connection.canInteract
          ? send.pipe(Effect.andThen(result))
          : Effect.fail(
              problem(
                "unsupported",
                "The runtime does not permit output interactions.",
              ),
            );
      });
    let action: Effect.Effect<A, CommError>;
    if (!current.hostComm && legacy) {
      const viewer = yield* attach(current, state.value.notebook, legacy);
      action = Deferred.await(viewer.ready).pipe(
        Effect.andThen(perform(legacy.post(viewer.sessionId, command))),
        Effect.raceFirst(Deferred.await(viewer.ended)),
      );
    } else {
      action = perform(sendToHost(current.id, command));
    }
    return yield* action.pipe(
      Effect.raceFirst(Deferred.await(current.ended)),
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () => Effect.fail(problem("timeout", "The comm request timed out.")),
      }),
    );
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
      request(message, { payload: message, headers: { idempotencyKey } }, Effect.void),
    invoke: Effect.fnUntraced(function* (input: Invoke) {
      const { call } = input;
      if (calls.has(call))
        return yield* problem(
          "rpc",
          "A Python call with this request ID is already pending.",
        );
      const reply = yield* Deferred.make<Json, CommError>();
      calls.set(call, reply);
      return yield* request(
        input,
        {
          payload: {
            _tag: "Invoke",
            call,
            name: input.name,
            namespace: input.namespace,
            args: input.args,
          },
          headers: { idempotencyKey: call },
        },
        Deferred.await(reply),
      ).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            calls.delete(call);
          }),
        ),
      );
    }),
  } satisfies Interface;
});
