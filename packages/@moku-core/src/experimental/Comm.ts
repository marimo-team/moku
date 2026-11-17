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
  Queue,
  Schema,
  Stream,
} from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as MarimoClient from "@marimo-team/client";
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
export interface Marimo extends NonNullable<Host.Options["marimo"]> {
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
    ): Effect.fn.Return<Interface, never, AtomRegistry.AtomRegistry | Scope.Scope> {
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
            Effect.gen(function* () {
              const call = crypto.randomUUID();
              const reply = yield* Effect.acquireRelease(
                Effect.sync(() => {
                  const result = Deferred.makeUnsafe<Json, CommError>();
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

const Frame = Schema.Struct({ event: Schema.String, data: Schema.Unknown });
const Envelope = Schema.Struct({ marimo: Schema.Unknown });
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
  readonly controller: AbortController;
  readonly ready: ReturnType<typeof Promise.withResolvers<void>>;
  readonly pending: Map<string, ReturnType<typeof Promise.withResolvers<Json>>>;
  canInteract: boolean;
}
interface Listener {
  readonly emit: (event: Event) => void;
  readonly end: () => void;
}

/** Wait without leaving an abort listener behind when the operation finishes. */
async function until<A>(promise: Promise<A>, signal: AbortSignal): Promise<A> {
  signal.throwIfAborted();
  const aborted = Promise.withResolvers<never>();
  const abort = () => aborted.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([promise, aborted.promise]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Opens marimo's session stream on demand for notebooks without the host operation. */
const makeMarimo = Effect.fnUntraced(function* (
  options: Marimo,
  notebookId: string,
  observed: Notebook.Interface["state"],
) {
  const registry = yield* AtomRegistry.AtomRegistry;
  const lifetime = new AbortController();
  const base = options.baseUrl.pathname.replace(/\/$/, "");
  const urlFor = (path: string) => new URL(base + path, options.baseUrl).href;
  const channel = Atom.make<Connection>(Connection.Idle());
  const unmount = registry.mount(channel);
  const snapshot = new CommProtocol.Snapshot();
  const listeners = new Set<Listener>();
  let connection: MarimoSession | undefined;
  let attempted: string | null = null;
  let references = 0;
  let unsubscribe: (() => void) | undefined;

  const emit = (event: Event) => {
    for (const listener of listeners) listener.emit(event);
  };
  const reset = (reason: CommError) => {
    const previous = connection;
    connection = undefined;
    previous?.controller.abort(reason);
    previous?.ready.reject(reason);
    for (const pending of previous?.pending.values() ?? []) pending.reject(reason);
    previous?.pending.clear();
    snapshot.reset();
    emit({ kind: "reset", runtimeId: null });
  };
  const fail = (current: MarimoSession, cause: unknown) => {
    if (connection !== current) return;
    const causeOfFailure = failure(cause);
    reset(causeOfFailure);
    registry.set(channel, Connection.Failed({ error: causeOfFailure }));
  };

  async function request(path: string, init: RequestInit): Promise<Response> {
    const response = await options.fetch(urlFor(path), init);
    if (response.ok) return response;
    await response.body?.cancel();
    throw problem(
      response.status === 401 ? "authentication" : "transport",
      response.status === 401
        ? "Authorize interactions with the marimo server token."
        : `Marimo refused the output request (${response.status}).`,
    );
  }
  async function post(
    path: string,
    body: unknown,
    signal: AbortSignal,
    sessionId?: string,
  ) {
    const response = await request(path, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        ...(sessionId ? { "Marimo-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
    const result = Schema.decodeUnknownSync(Schema.Struct({ success: Schema.Boolean }))(
      await response.json(),
    );
    if (!result.success)
      throw problem("transport", "Marimo did not accept the output request.");
  }

  async function filePath(
    notebook: typeof Protocol.Notebook.Type,
    signal: AbortSignal,
  ) {
    if (notebook.path === null)
      throw problem(
        "unsupported",
        "Opening a marimo session requires a notebook file path.",
      );
    if (/^(\/|[A-Za-z]:[\\/])/.test(notebook.path)) return notebook.path;
    const project = Promise.withResolvers<string>();
    const stop = registry.subscribe(
      options.catalog,
      (result) => {
        if (AsyncResult.isFailure(result) && !result.waiting)
          project.reject(problem("unavailable", "The host catalog is unavailable."));
        if (!AsyncResult.isSuccess(result) || result.waiting) return;
        const root = result.value.projects[notebook.project_id]?.root;
        if (root) project.resolve(root);
        else
          project.reject(
            problem("unavailable", "The notebook's project is unavailable."),
          );
      },
      { immediate: true },
    );
    try {
      const root = await until(project.promise, signal);
      const separator = root.includes("\\") ? "\\" : "/";
      return (
        root.replace(/[\\/]$/, "") +
        separator +
        notebook.path.replaceAll("/", separator)
      );
    } finally {
      stop();
    }
  }

  async function open(current: MarimoSession, notebook: typeof Protocol.Notebook.Type) {
    const signal = current.controller.signal;
    const preparing = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
    await post("/auth", {}, preparing);
    const file = await filePath(notebook, preparing);
    if (signal.aborted) return;
    const url = new URL(urlFor("/sse"));
    url.searchParams.set("session_id", current.sessionId);
    url.searchParams.set("file", file);
    let sessionNotebookId: string | undefined;
    let sessionRuntimeId: string | undefined;
    const receive = (input: unknown) => {
      if (connection !== current) return;
      try {
        const frame = Schema.decodeUnknownSync(Frame)(input);
        if (frame.event === "notebook") {
          const record = Schema.decodeUnknownSync(
            Schema.Struct({ notebook: Schema.Unknown }),
          )(frame.data);
          sessionNotebookId = Schema.decodeUnknownSync(Protocol.Notebook)(
            record.notebook,
          ).id;
          if (sessionNotebookId !== notebookId)
            throw problem(
              "stale-runtime",
              "The output connection belongs to another notebook.",
            );
        }
        if (frame.event === "runtime") {
          const record = Schema.decodeUnknownSync(
            Schema.Struct({ runtime: Schema.Unknown }),
          )(frame.data);
          const runtime = Schema.decodeUnknownSync(Protocol.Runtime)(record.runtime);
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
        const raw = Schema.decodeUnknownSync(Envelope)(frame.data).marimo;
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
          if (notification.op === "kernel-ready") current.ready.resolve();
        }
        if (notification.op === "function-call-result") {
          const pending = current.pending.get(notification.function_call_id);
          current.pending.delete(notification.function_call_id);
          if (notification.found && notification.status.code === "ok")
            pending?.resolve(notification.return_value);
          else
            pending?.reject(
              problem(
                "rpc",
                notification.status.message ??
                  notification.status.title ??
                  "The kernel function failed.",
              ),
            );
        }
        emit({ kind: "notification", runtimeId: current.runtimeId, notification });
      } catch (cause) {
        fail(current, cause);
      }
    };
    await MarimoClient.sse(url, {
      fetch: async (_input, init) => {
        try {
          return await request("/sse" + url.search, init ?? {});
        } catch (cause) {
          fail(current, cause);
          throw cause;
        }
      },
      stop: (frame) =>
        frame.event === "close"
          ? problem("unavailable", "The marimo session closed.")
          : undefined,
    })({ cursor: null, signal }, { open: () => {}, message: receive });
    if (!signal.aborted)
      throw problem("transport", "The output connection ended. Reconnect to continue.");
  }

  function synchronize() {
    const state = registry.get(observed);
    const notebook = AsyncResult.getOrElse(state, () => undefined)?.notebook;
    const runtime = AsyncResult.getOrElse(state, () => undefined)?.runtime;
    const key =
      !lifetime.signal.aborted &&
      references > 0 &&
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
      controller: new AbortController(),
      ready: Promise.withResolvers<void>(),
      pending: new Map(),
      canInteract: false,
    };
    void current.ready.promise.catch(() => {});
    connection = current;
    registry.set(channel, Connection.Connecting());
    const deadline = setTimeout(
      () =>
        fail(
          current,
          problem("timeout", "The output connection did not become ready."),
        ),
      10_000,
    );
    void current.ready.promise.then(
      () => clearTimeout(deadline),
      () => clearTimeout(deadline),
    );
    void open(current, notebook).catch((cause) => fail(current, cause));
  }
  function acquire() {
    if (lifetime.signal.aborted) throw problem("closed", "The notebook is closed.");
    references++;
    if (references === 1)
      unsubscribe = registry.subscribe(observed, synchronize, { immediate: true });
    return () => {
      if (--references !== 0) return;
      unsubscribe?.();
      unsubscribe = undefined;
      attempted = null;
      reset(problem("closed", "The output connection was released."));
      registry.set(channel, Connection.Idle());
    };
  }

  const events = Stream.callback<Event>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const release = acquire();
        const listener: Listener = {
          emit: (event) => {
            Queue.offerUnsafe(queue, event);
          },
          end: () => {
            Queue.endUnsafe(queue);
          },
        };
        listener.emit({ kind: "reset", runtimeId: connection?.runtimeId ?? null });
        if (connection)
          for (const notification of snapshot.messages())
            listener.emit({
              kind: "notification",
              runtimeId: connection.runtimeId,
              notification,
            });
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          release();
        };
      }),
      (release) => Effect.sync(release),
    ),
  );

  function interact<A>(
    input: Target,
    perform: (current: MarimoSession, signal: AbortSignal) => Promise<A>,
  ) {
    return Effect.tryPromise({
      try: async (caller) => {
        const runtime = AsyncResult.getOrElse(
          registry.get(observed),
          () => undefined,
        )?.runtime;
        if (lifetime.signal.aborted) throw problem("closed", "The notebook is closed.");
        if (input.runtimeId !== undefined && input.runtimeId !== runtime?.id)
          throw problem("stale-runtime", "This output belongs to an earlier runtime.");
        if (runtime?.status !== "running")
          throw problem(
            "unavailable",
            "Start the notebook runtime to interact with outputs.",
          );
        const release = acquire();
        try {
          const current = connection;
          if (!current) {
            const state = registry.get(channel);
            throw state._tag === "Failed"
              ? state.error
              : problem("unavailable", "The output connection is unavailable.");
          }
          const signal = AbortSignal.any([
            caller,
            lifetime.signal,
            current.controller.signal,
            AbortSignal.timeout(30_000),
          ]);
          await until(current.ready.promise, signal);
          if (connection !== current || current.runtimeId !== runtime.id)
            throw problem("stale-runtime", "The output runtime changed.");
          if (!current.canInteract)
            throw problem(
              "unsupported",
              "This connection does not permit output interactions.",
            );
          return await perform(current, signal);
        } finally {
          release();
        }
      },
      catch: (cause) =>
        cause instanceof DOMException && cause.name === "TimeoutError"
          ? problem("timeout", "The output interaction timed out.")
          : failure(cause),
    });
  }

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      lifetime.abort(problem("closed", "The notebook is closed."));
      unsubscribe?.();
      unsubscribe = undefined;
      reset(problem("closed", "The notebook is closed."));
      for (const listener of listeners) listener.end();
      listeners.clear();
      unmount();
    }),
  );

  return {
    state: Atom.readable((get): State => ({
      runtime: AsyncResult.getOrElse(get(observed), () => undefined)?.runtime ?? null,
      connection: get(channel),
    })),
    events,
    retry: Effect.sync(() => {
      attempted = null;
      synchronize();
    }),
    send: (input: Message) =>
      interact(input, (current, signal) =>
        input._tag === "SetValues"
          ? post(
              "/api/kernel/set_ui_element_value",
              {
                objectIds: Object.keys(input.values),
                values: Object.values(input.values),
              },
              signal,
              current.sessionId,
            )
          : post(
              "/api/kernel/set_model_value",
              {
                modelId: input.model,
                message: input.message,
                buffers: input.buffers,
              },
              signal,
              current.sessionId,
            ),
      ),
    invoke: (input: Invoke) =>
      interact(input, async (current, signal) => {
        const functionCallId = crypto.randomUUID();
        const result = Promise.withResolvers<Json>();
        void result.promise.catch(() => {});
        current.pending.set(functionCallId, result);
        try {
          await post(
            "/api/kernel/function_call",
            {
              functionCallId,
              namespace: input.namespace,
              functionName: input.name,
              args: input.args,
            },
            signal,
            current.sessionId,
          );
          return await until(result.promise, signal);
        } finally {
          current.pending.delete(functionCallId);
        }
      }),
  } satisfies Interface;
});
