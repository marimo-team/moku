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
  type Cause,
  type Scope,
  Data,
  Deferred,
  Effect,
  FiberSet,
  Queue,
  RcRef,
  Schema,
  Stream,
} from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { Sse } from "effect/encoding";
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import * as CommProtocol from "../internal/comm-protocol.ts";
import type { Client } from "../internal/client.ts";
import type * as Host from "../Host.ts";
import type * as Notebook from "../Notebook.ts";
import * as Protocol from "../Protocol.ts";
import type { NotebookState } from "../notebook/state.ts";

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

/** The marimo session route and catalog used to resolve notebook paths. */
export interface Marimo {
  readonly baseUrl: URL;
  /** Supplies project roots for relative notebook paths. */
  readonly catalog: Host.Interface["state"];
}

/** Connects notebook observation and chooses the output transport as capabilities change. */
export const make = Effect.fnUntraced(function* (
  client: Client,
  notebookId: typeof Protocol.NotebookId.Type,
  marimo?: Marimo,
) {
  const host = yield* makeHost(client, notebookId);
  return {
    ...host,
    bind: Effect.fnUntraced(function* (
      observed: Notebook.Interface["state"],
      retry: Effect.Effect<void>,
    ): Effect.fn.Return<
      Interface,
      never,
      HttpClient.HttpClient | AtomRegistry.AtomRegistry | Scope.Scope
    > {
      const channel = host.bind(observed, retry);
      if (!marimo) return channel;
      const fallback = yield* makeMarimo(marimo, notebookId, observed);
      const registry = yield* AtomRegistry.AtomRegistry;
      const selected = Atom.readable((get) =>
        AsyncResult.getOrElse(
          get(observed),
          () => undefined,
        )?.notebook?.operations.includes(CommProtocol.operation)
          ? channel
          : fallback,
      );
      const closed = yield* Deferred.make<void>();
      yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined));
      return {
        state: Atom.readable((get) => get(get(selected).state)),
        events: AtomRegistry.toStream(registry, selected).pipe(
          Stream.switchMap((comm) => comm.events),
          Stream.interruptWhen(Deferred.await(closed)),
        ),
        send: (message) => Effect.suspend(() => registry.get(selected).send(message)),
        invoke: (request) =>
          Effect.suspend(() => registry.get(selected).invoke(request)),
        retry: Effect.suspend(() => registry.get(selected).retry),
      };
    }),
  };
});

const problem = (code: CommError["code"], message: string) =>
  new CommError({ code, message });

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

const makeHost = Effect.fnUntraced(function* (
  client: Client,
  notebookId: typeof Protocol.NotebookId.Type,
) {
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
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      reset();
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

  return {
    reset,
    receive(state: NotebookState, event: Protocol.NotebookEvent) {
      const id =
        state.notebook?.operations.includes(CommProtocol.operation) &&
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
    bind(observed: Notebook.Interface["state"], retry: Effect.Effect<void>): Interface {
      type Payload = Parameters<Client["Comm"]["send"]>[0]["payload"];
      const post = (id: string, payload: Payload) =>
        client.Comm.send({ params: { notebookId }, payload }).pipe(
          Effect.mapError(
            (cause) =>
              new CommError({
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
        target: Target,
        run: (id: string) => Effect.Effect<A, CommError>,
      ) =>
        Effect.suspend<A, CommError, never>(() => {
          if (closed) return Effect.fail(problem("closed", "The notebook is closed."));
          if (target.runtimeId !== undefined && active?.id !== target.runtimeId)
            return Effect.fail(
              problem("stale-runtime", "This output belongs to an earlier runtime."),
            );
          const state = registry.get(observed);
          if (!AsyncResult.isSuccess(state) || state.waiting)
            return Effect.fail(problem("unavailable", "The notebook is reconnecting."));
          if (!state.value.notebook?.operations.includes(CommProtocol.operation))
            return Effect.fail(
              problem(
                "unsupported",
                "The notebook does not offer runtime.experimental.comm.",
              ),
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
    },
  };
});

const NotebookFrame = Schema.fromJsonString(
  Schema.Struct({ notebook: Protocol.Notebook }),
);
const RuntimeFrame = Schema.fromJsonString(
  Schema.Struct({ runtime: Protocol.Runtime }),
);
const NotificationFrame = Schema.fromJsonString(
  Schema.Struct({ marimo: Schema.Unknown }),
);
const Acknowledgement = Schema.Struct({ success: Schema.Boolean });
const failure = (cause: unknown) =>
  cause instanceof CommError
    ? cause
    : new CommError({
        code: "transport",
        message: "The output connection failed.",
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

/** Opens marimo's session stream on demand for notebooks without the host operation. */
const makeMarimo = Effect.fnUntraced(function* (
  options: Marimo,
  notebookId: string,
  observed: Notebook.Interface["state"],
) {
  const registry = yield* AtomRegistry.AtomRegistry;
  let closed = false;
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      HttpClientRequest.prependUrl(options.baseUrl.href.replace(/\/$/, "")),
    ),
    HttpClient.withScope,
    HttpClient.transformResponse(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.succeed(response)
          : Effect.fail(
              response.status === 401
                ? problem(
                    "authentication",
                    "Authorize interactions with the marimo server token.",
                  )
                : problem(
                    "transport",
                    `Marimo refused the output request (${response.status}).`,
                  ),
            ),
      ),
    ),
  );
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
  function post(path: string, body: unknown, sessionId?: string) {
    return http
      .post(path, {
        body: HttpBody.jsonUnsafe(body),
        headers: sessionId ? { "Marimo-Session-Id": sessionId } : undefined,
      })
      .pipe(
        Effect.flatMap(HttpClientResponse.schemaBodyJson(Acknowledgement)),
        Effect.flatMap(({ success }) =>
          success
            ? Effect.void
            : Effect.fail(
                problem("transport", "Marimo did not accept the output request."),
              ),
        ),
        Effect.mapError(failure),
        Effect.scoped,
      );
  }

  const filePath = Effect.fnUntraced(function* (
    notebook: typeof Protocol.Notebook.Type,
  ) {
    if (notebook.path === null)
      return yield* problem(
        "unsupported",
        "Opening a marimo session requires a notebook file path.",
      );
    if (/^(\/|[A-Za-z]:[\\/])/.test(notebook.path)) return notebook.path;
    const catalog = yield* AtomRegistry.getResult(registry, options.catalog, {
      suspendOnWaiting: true,
    }).pipe(
      Effect.mapError(() => problem("unavailable", "The host catalog is unavailable.")),
    );
    const root = catalog.projects[notebook.project_id]?.root;
    if (!root)
      return yield* problem("unavailable", "The notebook's project is unavailable.");
    const separator = root.includes("\\") ? "\\" : "/";
    return (
      root.replace(/[\\/]$/, "") + separator + notebook.path.replaceAll("/", separator)
    );
  });

  const open = Effect.fnUntraced(function* (
    current: MarimoSession,
    notebook: typeof Protocol.Notebook.Type,
  ) {
    yield* post("/auth", {});
    const file = yield* filePath(notebook);
    let sessionNotebookId: string | undefined;
    let sessionRuntimeId: string | undefined;
    const receive = (frame: Sse.Event) => {
      if (connection !== current) return;
      if (frame.event === "close")
        throw problem("unavailable", "The marimo session closed.");
      if (frame.event === "notebook") {
        const { notebook } = Schema.decodeUnknownSync(NotebookFrame)(frame.data);
        sessionNotebookId = notebook.id;
        if (sessionNotebookId !== notebookId)
          throw problem(
            "stale-runtime",
            "The output connection belongs to another notebook.",
          );
      }
      if (frame.event === "runtime") {
        const { runtime } = Schema.decodeUnknownSync(RuntimeFrame)(frame.data);
        sessionRuntimeId = runtime.id;
        if (
          runtime.notebook_id !== notebookId ||
          runtime.id !== current.runtimeId ||
          runtime.status !== "running"
        )
          throw problem(
            "stale-runtime",
            "The runtime changed while connecting outputs.",
          );
      }
      if (["reset", "runtime.removed", "notebook.removed"].includes(frame.event))
        throw problem(
          "stale-runtime",
          "The output session was reset. Reconnect to continue.",
        );
      if (frame.event !== "marimo") return;
      const raw = Schema.decodeUnknownSync(NotificationFrame)(frame.data).marimo;
      const notification = snapshot.recordNotification(raw, (cause) => {
        throw cause;
      });
      if (!notification) return;
      if (sessionNotebookId !== notebookId || sessionRuntimeId !== current.runtimeId)
        throw problem(
          "stale-runtime",
          "The output connection did not confirm its runtime identity.",
        );
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
    };
    const response = yield* http.get("/sse", {
      urlParams: { session_id: current.sessionId, file },
      headers: { Accept: "text/event-stream" },
    });
    if (
      response.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
      "text/event-stream"
    )
      return yield* problem("transport", "Marimo did not return an event stream.");
    yield* response.stream.pipe(
      Stream.timeout("45 seconds"),
      Stream.decodeText,
      Stream.pipeThroughChannel(Sse.decode()),
      Stream.runForEach((frame) =>
        Effect.try({ try: () => receive(frame), catch: failure }),
      ),
    );
    return yield* problem(
      "transport",
      "The output connection ended. Reconnect to continue.",
    );
  }, Effect.scoped);

  const attachment = yield* RcRef.make({
    acquire: Effect.gen(function* () {
      const runSession = yield* FiberSet.makeRuntime();
      let attempted: string | null = null;
      function synchronize() {
        const state = registry.get(observed);
        const notebook = AsyncResult.getOrElse(state, () => undefined)?.notebook;
        const runtime = AsyncResult.getOrElse(state, () => undefined)?.runtime;
        const key =
          !closed &&
          AsyncResult.isSuccess(state) &&
          !state.waiting &&
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
          open(current, notebook).pipe(
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

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      closed = true;
      reset(problem("closed", "The notebook is closed."));
      for (const reader of readers) Queue.endUnsafe(reader);
      readers.clear();
    }),
  );

  return {
    state: Atom.readable((get): State => ({
      runtime: AsyncResult.getOrElse(get(observed), () => undefined)?.runtime ?? null,
      connection: get(channel),
    })),
    events,
    retry: Effect.sync(() => retry?.()),
    send: (input: Message) =>
      interact(input, (current) =>
        input._tag === "SetValues"
          ? post(
              "/api/kernel/set_ui_element_value",
              {
                objectIds: Object.keys(input.values),
                values: Object.values(input.values),
              },
              current.sessionId,
            )
          : post(
              "/api/kernel/set_model_value",
              {
                modelId: input.model,
                message: input.message,
                buffers: input.buffers,
              },
              current.sessionId,
            ),
      ),
    invoke: (input: Invoke) =>
      interact(input, (current) =>
        invoke(current.pending, (functionCallId) =>
          post(
            "/api/kernel/function_call",
            {
              functionCallId,
              namespace: input.namespace,
              functionName: input.name,
              args: input.args,
            },
            current.sessionId,
          ),
        ),
      ),
  } satisfies Interface;
});
