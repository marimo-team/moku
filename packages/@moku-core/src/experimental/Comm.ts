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
  FiberSet,
  Queue,
  RcRef,
  Schema,
  Scope,
  Stream,
} from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Events from "../notebook/events.ts";
import * as CommProtocol from "../internal/comm-protocol.ts";
import type { Client } from "../internal/client.ts";
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
      /** The decoded message for the output renderer. */
      readonly notification: CommProtocol.Notification;
    };

class CommError extends Data.TaggedError("CommError")<{
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
interface UIValues extends Target {
  /** Values keyed by UI element ID; omitted elements are unchanged. */
  readonly values: Readonly<Record<string, Json>>;
}
interface Invoke extends Target {
  /** The function registry that owns the callable. */
  readonly namespace: string;
  readonly name: string;
  readonly args: Readonly<Record<string, Json>>;
}
/** An anywidget state patch or custom message with its binary attachments. */
interface WidgetMessage extends Target {
  /** The widget model that receives this message. */
  readonly model: string;
  /** A state patch or transient custom message. */
  readonly message: (typeof CommProtocol.ModelValue.Type)["message"];
  /** Encoded binary attachments; empty when the message has none. */
  readonly buffers: readonly string[];
}

type Message = Data.TaggedEnum<{ SetValues: UIValues; Model: WidgetMessage }>;
type Connection = Data.TaggedEnum<{
  /** No output attachment is active, including when no runtime is running. */
  Idle: {};
  /** Opening the session stream and confirming its runtime. */
  Connecting: {};
  /** Receiving output notifications with host-granted permissions. */
  Connected: {
    /** False for a read-only viewer that can receive updates but cannot send changes. */
    readonly canInteract: boolean;
  };
  /** An attachment attempt failed; active readers retain its error. */
  Failed: {
    /** The failure to display while awaiting retry or a runtime change. */
    readonly error: CommError;
  };
}>;
const Connection = Data.taggedEnum<Connection>();

/** Kernel identity and the availability of its output connection. */
interface State {
  /** The notebook's observed runtime, or null when none exists. */
  readonly runtime: typeof Protocol.Runtime.Type | null;
  /** Output connection state, independent of notebook observation. */
  readonly connection: Connection;
}

/**
 * Widget state and actions for an attached notebook.
 *
 * Closing the notebook ends subscriptions and cancels pending calls.
 */
export interface Interface {
  /** Reports connection status and whether widgets can send updates. Reading it does not open a session. */
  readonly state: Atom.Atom<State>;
  /**
   * Restores the renderer’s current widget state and delivers subsequent updates.
   *
   * A reset tells the renderer to discard its widget registrations. Each new
   * reader then receives the saved UI values and open models for the runtime.
   * Custom messages and function replies are delivered only to live readers.
   */
  readonly events: Stream.Stream<Event, CommError>;
  /**
   * Sends a UI value or widget message and completes when the server accepts it.
   *
   * Kernel updates arrive on {@link Interface.events}. A failed request may
   * already have reached the kernel, so sends are attempted once.
   */
  readonly send: (message: Message) => Effect.Effect<void, CommError>;
  /**
   * Calls a registered Python function and returns its result.
   *
   * The 30-second timeout includes connecting and waiting for the kernel’s
   * reply. Restarting the runtime fails calls that are still waiting.
   */
  readonly invoke: (options: Invoke) => Effect.Effect<Json, CommError>;
  /** Requests a reconnect. Observe {@link Interface.state} to see when widgets can interact again. */
  readonly retry: Effect.Effect<void>;
}

interface Observation {
  readonly state: Notebook.Interface["state"];
  readonly events: Stream.Stream<Events.Update>;
  readonly reconnect: Effect.Effect<void>;
  readonly id: typeof Protocol.NotebookId.Type;
  readonly send: (
    payload: Parameters<Client["Comm"]["send"]>[0]["payload"],
  ) => Effect.Effect<typeof Protocol.Runtime.Type, Notebook.CommandError>;
  readonly viewer?: ReturnType<typeof Events.session> | undefined;
}

interface Implementation extends Interface {
  readonly receive: (update: Events.Update) => void;
}

/** Keep one comm implementation for the capabilities advertised by the attached notebook. */
export const make = Effect.fnUntraced(function* (notebook: Observation) {
  const registry = yield* AtomRegistry.AtomRegistry;
  const owner = yield* Effect.scope;
  const closed = yield* Deferred.make<void>();
  const openHost = makeHostComm(notebook);
  const openLegacy = notebook.viewer?.pipe(
    Effect.flatMap((viewer) => makeLegacyComm(viewer, notebook.state)),
  );
  type Open = typeof openHost | NonNullable<typeof openLegacy>;
  const selected = Atom.make<
    { open: Open; scope: Scope.Closeable; comm: Implementation } | undefined
  >(undefined);
  yield* Atom.mount(selected);

  const select = Effect.fnUntraced(function* (open: Open | undefined) {
    const previous = registry.get(selected);
    if (previous?.open === open) return;
    if (previous) {
      registry.set(selected, undefined);
      yield* Scope.close(
        previous.scope,
        Exit.fail(problem("stale-runtime", "The notebook's comm capability changed.")),
      );
    }
    if (!open) return;
    const scope = yield* Scope.fork(owner);
    const comm = yield* Scope.provide(scope)(open);
    registry.set(selected, { open, scope, comm });
  });

  yield* notebook.events.pipe(
    Stream.runForEach(
      Effect.fnUntraced(function* (update) {
        const { event, state } = update;
        if (event && !("_tag" in event)) {
          if (event.event === "notebook") {
            yield* select(
              event.data.notebook.operations.includes(CommProtocol.operation)
                ? openHost
                : openLegacy,
            );
          } else if (
            !state.notebook &&
            (event.event === "notebook.removed" || event.event === "ready")
          ) {
            yield* select(undefined);
          }
        }
        registry.get(selected)?.comm.receive(update);
      }),
    ),
    Effect.forkScoped,
  );
  yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined));
  const request = <A>(run: (comm: Interface) => Effect.Effect<A, CommError>) =>
    Effect.suspend(() => {
      if (Deferred.isDoneUnsafe(closed))
        return Effect.fail(problem("closed", "The notebook is closed."));
      const active = registry.get(selected);
      if (active) return run(active.comm);
      const result = registry.get(notebook.state);
      return Effect.fail(
        AsyncResult.isSuccess(result) &&
          !result.waiting &&
          result.value.notebook &&
          !notebook.viewer &&
          !result.value.notebook.operations.includes(CommProtocol.operation)
          ? problem(
              "unsupported",
              "The notebook does not offer runtime.experimental.comm.",
            )
          : problem("unavailable", "The output connection is unavailable."),
      );
    });
  return {
    state: Atom.readable((get): State => {
      const active = get(selected);
      if (active) return get(active.comm.state);
      const result = get(notebook.state);
      return {
        runtime: AsyncResult.getOrElse(result, () => undefined)?.runtime ?? null,
        connection: result.waiting
          ? Connection.Connecting()
          : AsyncResult.isFailure(result)
            ? Connection.Failed({
                error: problem("transport", "The notebook event stream failed."),
              })
            : Connection.Idle(),
      };
    }),
    events: AtomRegistry.toStream(registry, selected).pipe(
      Stream.switchMap((active) =>
        active
          ? active.comm.events
          : Stream.succeed<Event>({ kind: "reset", runtimeId: null }),
      ),
      Stream.interruptWhen(Deferred.await(closed)),
    ),
    send: (message) => request((comm) => comm.send(message)),
    invoke: (input) => request((comm) => comm.invoke(input)),
    retry: Effect.suspend(
      () => registry.get(selected)?.comm.retry ?? notebook.reconnect,
    ),
  } satisfies Interface;
});

const problem = (code: CommError["code"], message: string) =>
  new CommError({ code, message });

function closeReason(exit: Exit.Exit<unknown, unknown>) {
  const reason = Exit.isFailure(exit) && Cause.squash(exit.cause);
  return reason instanceof CommError
    ? reason
    : problem("closed", "The notebook is closed.");
}

type PendingCalls = Map<string, Deferred.Deferred<Json, CommError>>;

const invoke = Effect.fnUntraced(function* (
  calls: PendingCalls,
  post: (call: string) => Effect.Effect<void, CommError>,
) {
  const call = crypto.randomUUID();
  const reply = yield* Deferred.make<Json, CommError>();
  calls.set(call, reply);
  return yield* post(call).pipe(
    Effect.andThen(Deferred.await(reply)),
    Effect.ensuring(
      Effect.sync(() => {
        calls.delete(call);
      }),
    ),
  );
});

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

const makeHostComm = Effect.fnUntraced(function* (notebook: Observation) {
  const registry = yield* AtomRegistry.AtomRegistry;
  const snapshot = new CommProtocol.Snapshot();
  const readers = new Set<Queue.Queue<Event, Cause.Done>>();
  const calls = new Map<string, Deferred.Deferred<Json, CommError>>();
  let active: { id: string; ended: Deferred.Deferred<never, CommError> } | undefined;
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
  function deliver(runtimeId: string, raw: unknown) {
    const notification = snapshot.recordNotification(raw);
    if (!notification) return;
    if (
      notification.op === "kernel-ready" ||
      notification.op === "consumer-capabilities"
    )
      registry.set(
        channel,
        Connection.Connected({
          canInteract: notification.consumer_capabilities?.interact === true,
        }),
      );
    replyToCall(calls, notification);
    emit({ kind: "notification", runtimeId, notification });
  }
  yield* Effect.addFinalizer((exit) =>
    Effect.sync(() => {
      closed = true;
      reset(closeReason(exit));
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
    if (!event) return reset();
    if ("_tag" in event) return;
    const id = state.runtime?.status === "running" ? state.runtime.id : undefined;
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
  }
  type Payload = Parameters<Client["Comm"]["send"]>[0]["payload"];
  const post = (id: string, payload: Payload) =>
    notebook.send(payload).pipe(
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
  const request = <A>(
    target: Target,
    run: (id: string) => Effect.Effect<A, CommError>,
  ) =>
    Effect.suspend<A, CommError, never>(() => {
      if (closed) return Effect.fail(problem("closed", "The notebook is closed."));
      if (target.runtimeId !== undefined && active?.id !== target.runtimeId)
        return Effect.fail(
          problem("stale-runtime", "This output belongs to an earlier runtime."),
        );
      const state = registry.get(notebook.state);
      if (!AsyncResult.isSuccess(state) || state.waiting)
        return Effect.fail(problem("unavailable", "The notebook is reconnecting."));
      if (!state.value.notebook?.operations.includes(CommProtocol.operation))
        return Effect.fail(
          problem(
            "unsupported",
            "The notebook does not offer runtime.experimental.comm.",
          ),
        );
      if (!active || state.value.runtime?.id !== active.id)
        return Effect.fail(
          problem("unavailable", "Start the runtime to interact with outputs."),
        );
      const connection = registry.get(channel);
      if (connection._tag !== "Connected" || !connection.canInteract)
        return Effect.fail(
          problem("unsupported", "The runtime does not permit output interactions."),
        );
      return run(active.id).pipe(
        Effect.raceFirst(Deferred.await(active.ended)),
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () => Effect.fail(problem("timeout", "The comm request timed out.")),
        }),
      );
    });
  const comm: Interface = {
    state: Atom.readable((get) => {
      const result = get(notebook.state);
      const runtime = AsyncResult.getOrElse(result, () => undefined)?.runtime ?? null;
      if (AsyncResult.isFailure(result) && !result.waiting)
        return {
          runtime,
          connection: Connection.Failed({
            error: problem("transport", "The notebook event stream failed."),
          }),
        };
      return {
        runtime,
        connection: result.waiting ? Connection.Connecting() : get(channel),
      };
    }),
    events,
    retry: notebook.reconnect,
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
        invoke(calls, (call) =>
          post(id, {
            _tag: "Invoke",
            call,
            namespace: input.namespace,
            name: input.name,
            args: input.args,
          }),
        ),
      ),
  };
  return { ...comm, receive } satisfies Implementation;
});

const failure = (cause: unknown) =>
  cause instanceof CommError
    ? cause
    : new CommError({
        code: cause instanceof Events.ViewerError ? cause.code : "transport",
        message:
          cause instanceof Events.ViewerError
            ? cause.message
            : "The output connection failed.",
        cause,
      });

interface MarimoSession {
  readonly runtimeId: string;
  readonly sessionId: string;
  readonly ended: Deferred.Deferred<never, CommError>;
  readonly ready: Deferred.Deferred<void>;
  readonly pending: PendingCalls;
  canInteract: boolean;
}

const makeLegacyComm = Effect.fnUntraced(function* (
  viewer: Events.Session,
  observed: Notebook.Interface["state"],
) {
  const registry = yield* AtomRegistry.AtomRegistry;
  let closed = false;
  const channel = Atom.make<Connection>(Connection.Idle());
  yield* Atom.mount(channel);
  const snapshot = new CommProtocol.Snapshot();
  const readers = new Set<Queue.Queue<Event, Cause.Done>>();
  let connection: MarimoSession | undefined;
  let retry: (() => void) | undefined;

  const emit = (event: Event) => {
    for (const reader of readers) Queue.offerUnsafe(reader, event);
  };
  const reset = (reason: CommError) => {
    const previous = connection;
    connection = undefined;
    if (previous) Deferred.doneUnsafe(previous.ended, Effect.fail(reason));
    snapshot.reset();
    emit({ kind: "reset", runtimeId: null });
  };
  function receive({ event }: Events.Update) {
    if (!event || "_tag" in event || event.event !== "marimo") return;
    const current = connection;
    if (!current || current.sessionId !== event.sessionId) return;
    const notification = snapshot.recordNotification(event.data.marimo);
    if (!notification) return;
    if (
      notification.op === "kernel-ready" ||
      notification.op === "consumer-capabilities"
    ) {
      current.canInteract = notification.consumer_capabilities?.interact === true;
      registry.set(
        channel,
        Connection.Connected({
          canInteract: current.canInteract,
        }),
      );
      if (notification.op === "kernel-ready")
        Deferred.doneUnsafe(current.ready, Effect.void);
    }
    replyToCall(current.pending, notification);
    emit({ kind: "notification", runtimeId: current.runtimeId, notification });
  }

  const attachment = yield* RcRef.make({
    acquire: Effect.gen(function* () {
      const runSession = yield* FiberSet.makeRuntime();
      let attempted: string | null = null;
      function synchronize() {
        const state = registry.get(observed);
        if (state.waiting) return;
        const notebook = AsyncResult.getOrElse(state, () => undefined)?.notebook;
        const runtime = AsyncResult.getOrElse(state, () => undefined)?.runtime;
        const key =
          !closed &&
          AsyncResult.isSuccess(state) &&
          notebook &&
          !notebook.operations.includes(CommProtocol.operation) &&
          runtime?.status === "running"
            ? `${runtime.id}:${notebook.path}`
            : null;
        if (key === attempted) return;
        attempted = key;
        reset(problem("stale-runtime", "The runtime or output connection changed."));
        if (!key || !notebook || !runtime) {
          registry.set(channel, Connection.Idle());
          return;
        }
        const current: MarimoSession = {
          runtimeId: runtime.id,
          sessionId: crypto.randomUUID(),
          ended: Deferred.makeUnsafe(),
          ready: Deferred.makeUnsafe(),
          pending: new Map(),
          canInteract: false,
        };
        connection = current;
        registry.set(channel, Connection.Connecting());
        const readinessDeadline = Deferred.await(current.ready).pipe(
          Effect.timeoutOrElse({
            duration: "10 seconds",
            orElse: () =>
              Effect.fail(
                problem("timeout", "The output connection did not become ready."),
              ),
          }),
          Effect.andThen(Effect.never),
        );
        runSession(
          viewer.open(current, notebook).pipe(
            Effect.raceFirst(readinessDeadline),
            Effect.raceFirst(Deferred.await(current.ended)),
            Effect.catch((cause) =>
              Effect.sync(() => {
                if (connection !== current) return;
                const error = failure(cause);
                reset(error);
                registry.set(channel, Connection.Failed({ error }));
              }),
            ),
          ),
        );
      }

      const unsubscribe = registry.subscribe(observed, synchronize, {
        immediate: true,
      });
      retry = () => {
        attempted = null;
        synchronize();
      };
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unsubscribe();
          retry = undefined;
          reset(problem("closed", "The output connection was released."));
          registry.set(channel, Connection.Idle());
        }),
      );
    }),
  });

  const events = Stream.callback<Event>((queue) =>
    Effect.gen(function* () {
      if (closed) {
        yield* Queue.end(queue);
        return;
      }
      yield* RcRef.get(attachment);
      Queue.offerUnsafe(queue, {
        kind: "reset",
        runtimeId: connection?.runtimeId ?? null,
      });
      if (connection)
        for (const notification of snapshot.messages())
          Queue.offerUnsafe(queue, {
            kind: "notification",
            runtimeId: connection.runtimeId,
            notification,
          });
      readers.add(queue);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          readers.delete(queue);
        }),
      );
    }),
  );

  const interact = Effect.fnUntraced(function* <A>(
    input: Target,
    perform: (current: MarimoSession) => Effect.Effect<A, CommError>,
  ) {
    const runtime = AsyncResult.getOrElse(
      registry.get(observed),
      () => undefined,
    )?.runtime;
    if (closed) return yield* problem("closed", "The notebook is closed.");
    if (input.runtimeId !== undefined && input.runtimeId !== runtime?.id)
      return yield* problem(
        "stale-runtime",
        "This output belongs to an earlier runtime.",
      );
    if (runtime?.status !== "running")
      return yield* problem(
        "unavailable",
        "Start the notebook runtime to interact with outputs.",
      );
    yield* RcRef.get(attachment);
    const current = connection;
    if (!current) {
      const state = registry.get(channel);
      return yield* state._tag === "Failed"
        ? state.error
        : problem("unavailable", "The output connection is unavailable.");
    }
    return yield* Effect.gen(function* () {
      yield* Deferred.await(current.ready);
      if (connection !== current || current.runtimeId !== runtime.id)
        return yield* problem("stale-runtime", "The output runtime changed.");
      if (!current.canInteract)
        return yield* problem(
          "unsupported",
          "This connection does not permit output interactions.",
        );
      return yield* perform(current);
    }).pipe(
      Effect.raceFirst(Deferred.await(current.ended)),
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () =>
          Effect.fail(problem("timeout", "The output interaction timed out.")),
      }),
    );
  }, Effect.scoped);

  yield* Effect.addFinalizer((exit) =>
    Effect.sync(() => {
      closed = true;
      reset(closeReason(exit));
      for (const reader of readers) Queue.endUnsafe(reader);
      readers.clear();
    }),
  );

  return {
    receive,
    state: Atom.readable((get): State => ({
      runtime: AsyncResult.getOrElse(get(observed), () => undefined)?.runtime ?? null,
      connection: get(channel),
    })),
    events,
    retry: Effect.sync(() => retry?.()),
    send: (input: Message) =>
      interact(input, (current) =>
        viewer
          .post(
            current.sessionId,
            input._tag === "SetValues"
              ? { _tag: "SetValues", values: input.values }
              : {
                  _tag: "Model",
                  model: input.model,
                  message: input.message,
                  buffers: input.buffers,
                },
          )
          .pipe(Effect.mapError(failure)),
      ),
    invoke: (input: Invoke) =>
      interact(input, (current) =>
        invoke(current.pending, (call) =>
          viewer
            .post(current.sessionId, {
              _tag: "Invoke",
              call,
              namespace: input.namespace,
              name: input.name,
              args: input.args,
            })
            .pipe(Effect.mapError(failure)),
        ),
      ),
  } satisfies Implementation;
});
