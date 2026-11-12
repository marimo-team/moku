/**
 * Share one native output connection across a notebook's readers and requests.
 *
 * @module
 */
import * as MarimoClient from "@marimo-team/client";
import { Effect, Queue, Schema, Stream } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type * as Notebook from "../Notebook.ts";
import type * as Runtime from "../Runtime.ts";
import * as Interaction from "../Interaction.ts";
import * as Protocol from "../Protocol.ts";
import * as Transport from "./transport.ts";
import { Snapshot } from "./interaction-snapshot.ts";

const Frame = Schema.Struct({ event: Schema.String, data: Schema.Unknown });
const Envelope = Schema.Struct({ marimo: Schema.Unknown });
const Operation = Schema.Struct({ op: Schema.String });
const operations = new Set([
  "kernel-ready",
  "consumer-capabilities",
  "send-ui-element-message",
  "remove-ui-elements",
  "function-call-result",
  "model-lifecycle",
]);
const error = (code: Interaction.Error["code"], message: string) =>
  new Interaction.Error({ code, message });
const failure = (cause: unknown) =>
  cause instanceof Interaction.Error
    ? cause
    : new Interaction.Error({
        code: "transport",
        message: "The output connection failed.",
        cause,
      });

interface Connection {
  readonly runtimeId: string;
  readonly sessionId: string;
  readonly controller: AbortController;
  readonly ready: ReturnType<typeof Promise.withResolvers<void>>;
  readonly pending: Map<
    string,
    ReturnType<typeof Promise.withResolvers<Interaction.Json>>
  >;
  canInteract: boolean;
}
interface Listener {
  readonly emit: (event: Interaction.Event) => void;
  readonly end: () => void;
}
type Channel = Omit<Runtime.State, "runtime">;

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

export const make = (target: Notebook.Target, observed: Atom.Atom<Notebook.State>) =>
  Effect.gen(function* () {
    const transport = yield* Transport.Service;
    const registry = yield* AtomRegistry.AtomRegistry;
    const lifetime = new AbortController();
    const base = `/api/hosts/${encodeURIComponent(target.connectionId)}/marimo`;
    const channel = Atom.make<Channel>({
      connection: "idle",
      canInteract: false,
      error: null,
    });
    const unmount = registry.mount(channel);
    const snapshot = new Snapshot();
    const listeners = new Set<Listener>();
    let connection: Connection | undefined;
    let attempted: string | null = null;
    let references = 0;
    let unsubscribe: (() => void) | undefined;

    const emit = (event: Interaction.Event) => {
      for (const listener of listeners) listener.emit(event);
    };
    const reset = (reason: Interaction.Error) => {
      const previous = connection;
      connection = undefined;
      previous?.controller.abort(reason);
      previous?.ready.reject(reason);
      for (const pending of previous?.pending.values() ?? []) pending.reject(reason);
      previous?.pending.clear();
      snapshot.reset();
      emit({ kind: "reset", runtimeId: null });
    };
    const fail = (current: Connection, cause: unknown) => {
      if (connection !== current) return;
      const problem = failure(cause);
      reset(problem);
      registry.set(channel, {
        connection: "error",
        canInteract: false,
        error: problem,
      });
    };

    async function request(path: string, init: RequestInit): Promise<Response> {
      const response = await transport.fetch(transport.url(base + path), init);
      if (response.ok) return response;
      await response.body?.cancel();
      throw error(
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
      const result = Schema.decodeUnknownSync(
        Schema.Struct({ success: Schema.Boolean }),
      )(await response.json());
      if (!result.success)
        throw error("transport", "Marimo did not accept the output request.");
    }

    async function filePath(notebook: Protocol.NotebookOutput, signal: AbortSignal) {
      if (notebook.path === null)
        throw error("unsupported", "Native outputs require a notebook file path.");
      if (/^(\/|[A-Za-z]:[\\/])/.test(notebook.path)) return notebook.path;
      const project = Promise.withResolvers<string>();
      const events = transport
        .client(target.connectionId, signal)
        .events({ types: ["project"], signal });
      const stop = events.subscribe((event) => {
        if (
          event.event === "project" &&
          event.data.project.id === notebook.project_id &&
          event.data.project.root !== null
        )
          project.resolve(event.data.project.root);
        if (event.event === "ready")
          project.reject(
            error("unavailable", "The notebook's project is unavailable."),
          );
      }, project.reject);
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
        events.close();
      }
    }

    async function open(current: Connection, notebook: Protocol.NotebookOutput) {
      const signal = current.controller.signal;
      const preparing = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      await post("/auth", {}, preparing);
      const file = await filePath(notebook, preparing);
      if (signal.aborted) return;
      const url = new URL(transport.url(base + "/sse"));
      url.searchParams.set("session_id", current.sessionId);
      url.searchParams.set("file", file);
      let nativeNotebook: string | undefined;
      let nativeRuntime: string | undefined;
      const receive = (input: unknown) => {
        if (connection !== current) return;
        try {
          const frame = Schema.decodeUnknownSync(Frame)(input);
          if (frame.event === "notebook") {
            const record = Schema.decodeUnknownSync(
              Schema.Struct({ notebook: Schema.Unknown }),
            )(frame.data);
            nativeNotebook = Protocol.Notebook.parse(record.notebook).id;
            if (nativeNotebook !== target.notebookId)
              throw error(
                "stale-runtime",
                "The output connection belongs to another notebook.",
              );
          }
          if (frame.event === "runtime") {
            const record = Schema.decodeUnknownSync(
              Schema.Struct({ runtime: Schema.Unknown }),
            )(frame.data);
            const runtime = Protocol.Runtime.parse(record.runtime);
            nativeRuntime = runtime.id;
            if (
              runtime.notebook_id !== target.notebookId ||
              runtime.id !== current.runtimeId ||
              runtime.status !== "running"
            )
              throw error(
                "stale-runtime",
                "The runtime changed while connecting outputs.",
              );
          }
          if (["reset", "runtime.removed", "notebook.removed"].includes(frame.event))
            throw error(
              "stale-runtime",
              "The output session was reset. Reconnect to continue.",
            );
          if (frame.event !== "marimo") return;
          const raw = Schema.decodeUnknownSync(Envelope)(frame.data).marimo;
          if (!operations.has(Schema.decodeUnknownSync(Operation)(raw).op)) return;
          const notification = Schema.decodeUnknownSync(Interaction.Notification)(raw);
          if (
            nativeNotebook !== target.notebookId ||
            nativeRuntime !== current.runtimeId
          )
            throw error(
              "stale-runtime",
              "The output connection did not confirm its runtime identity.",
            );
          if (
            notification.op === "kernel-ready" ||
            notification.op === "consumer-capabilities"
          ) {
            current.canInteract = notification.consumer_capabilities?.interact === true;
            registry.set(channel, {
              connection: "connected",
              canInteract: current.canInteract,
              error: null,
            });
            if (notification.op === "kernel-ready") current.ready.resolve();
          }
          if (notification.op === "function-call-result") {
            const pending = current.pending.get(notification.function_call_id);
            current.pending.delete(notification.function_call_id);
            if (notification.found && notification.status.code === "ok")
              pending?.resolve(notification.return_value);
            else
              pending?.reject(
                error(
                  "rpc",
                  notification.status.message ??
                    notification.status.title ??
                    "The kernel function failed.",
                ),
              );
          }
          snapshot.accept(notification);
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
            ? error("unavailable", "The native output session closed.")
            : undefined,
      })({ cursor: null, signal }, { open: () => {}, message: receive });
      if (!signal.aborted)
        throw error("transport", "The output connection ended. Reconnect to continue.");
    }

    function synchronize() {
      const state = registry.get(observed);
      const { notebook, runtime } = state.value;
      const key =
        !lifetime.signal.aborted &&
        references > 0 &&
        state.status === "connected" &&
        state.value.ready &&
        notebook &&
        runtime?.status === "running"
          ? `${runtime.id}:${notebook.path}`
          : null;
      if (key === attempted) return;
      attempted = key;
      reset(error("stale-runtime", "The runtime or output connection changed."));
      if (!key || !notebook || !runtime) {
        registry.set(channel, { connection: "idle", canInteract: false, error: null });
        return;
      }
      const current: Connection = {
        runtimeId: runtime.id,
        sessionId: crypto.randomUUID(),
        controller: new AbortController(),
        ready: Promise.withResolvers<void>(),
        pending: new Map(),
        canInteract: false,
      };
      void current.ready.promise.catch(() => {});
      connection = current;
      registry.set(channel, {
        connection: "connecting",
        canInteract: false,
        error: null,
      });
      const deadline = setTimeout(
        () =>
          fail(
            current,
            error("timeout", "The output connection did not become ready."),
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
      if (lifetime.signal.aborted) throw error("closed", "The notebook is closed.");
      references++;
      if (references === 1)
        unsubscribe = registry.subscribe(observed, synchronize, { immediate: true });
      return () => {
        if (--references !== 0) return;
        unsubscribe?.();
        unsubscribe = undefined;
        attempted = null;
        reset(error("closed", "The output connection was released."));
        registry.set(channel, { connection: "idle", canInteract: false, error: null });
      };
    }

    const events = Stream.callback<Interaction.Event>((queue) =>
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
      input: Interaction.Target,
      perform: (current: Connection, signal: AbortSignal) => Promise<A>,
    ) {
      return Effect.tryPromise({
        try: async (caller) => {
          const runtime = registry.get(observed).value.runtime;
          if (lifetime.signal.aborted) throw error("closed", "The notebook is closed.");
          if (input.runtimeId !== undefined && input.runtimeId !== runtime?.id)
            throw error("stale-runtime", "This output belongs to an earlier runtime.");
          if (runtime?.status !== "running")
            throw error(
              "unavailable",
              "Start the notebook runtime to interact with outputs.",
            );
          const release = acquire();
          try {
            const current = connection;
            if (!current)
              throw (
                registry.get(channel).error ??
                error("unavailable", "The output connection is unavailable.")
              );
            const signal = AbortSignal.any([
              caller,
              lifetime.signal,
              current.controller.signal,
              AbortSignal.timeout(30_000),
            ]);
            await until(current.ready.promise, signal);
            if (connection !== current || current.runtimeId !== runtime.id)
              throw error("stale-runtime", "The output runtime changed.");
            if (!current.canInteract)
              throw error(
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
            ? error("timeout", "The output interaction timed out.")
            : failure(cause),
      });
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        lifetime.abort(error("closed", "The notebook is closed."));
        unsubscribe?.();
        unsubscribe = undefined;
        reset(error("closed", "The notebook is closed."));
        for (const listener of listeners) listener.end();
        listeners.clear();
        unmount();
      }),
    );

    return {
      state: Atom.readable((get): Runtime.State => ({
        runtime: get(observed).value.runtime,
        ...get(channel),
      })),
      events,
      retry: Effect.sync(() => {
        attempted = null;
        synchronize();
      }),
      assetUrl: (path: string) => {
        if (!/^(\.\/|\/)@file\//.test(path))
          throw new Error("Expected a marimo @file asset path.");
        const url = new URL(transport.url(base + path.replace(/^\./, "")));
        if (!url.pathname.startsWith(base + "/@file/"))
          throw new Error("Invalid asset path.");
        return url.href;
      },
      setUIValues: (input: Interaction.UIValues) =>
        interact(input, (current, signal) =>
          post(
            "/api/kernel/set_ui_element_value",
            {
              objectIds: Object.keys(input.values),
              values: Object.values(input.values),
            },
            signal,
            current.sessionId,
          ),
        ),
      sendWidgetMessage: (input: Interaction.WidgetMessage) =>
        interact(input, (current, signal) =>
          post(
            "/api/kernel/set_model_value",
            { modelId: input.modelId, message: input.message, buffers: input.buffers },
            signal,
            current.sessionId,
          ),
        ),
      invoke: (input: Interaction.Invoke) =>
        interact(input, async (current, signal) => {
          const functionCallId = crypto.randomUUID();
          const result = Promise.withResolvers<Interaction.Json>();
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
    };
  });
