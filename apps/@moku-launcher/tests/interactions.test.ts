// @vitest-environment happy-dom
import type * as CommProtocol from "@moku/core/internal/comm-protocol";
import * as Http from "./http.ts";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { Cause, Effect, Exit, Fiber, Scope, Stream } from "effect";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import * as Workspace from "../src/app/Workspace.ts";

const notebook = {
  id: "n",
  project_id: "p",
  name: "n.py",
  path: "n.py",
  operations: [],
  updated_at: null,
};
const runtime = {
  id: "rt",
  notebook_id: "n",
  status: "running",
  message: null,
  marimo_version: null,
  started_at: "2026-11-12T12:00:00Z",
};
interface Events {
  readonly signal: AbortSignal;
  readonly send: (event: string, data: unknown) => void;
}

async function fixture(
  operations: string[] = [],
  initialRuntime: typeof runtime | null = runtime,
) {
  let notebookStreams = 0;
  let peakNotebookStreams = 0;
  const activeStreams = new Set<Events>();
  const marimoStreams: Events[] = [];
  const requests: {
    path: string;
    body: Record<string, unknown>;
  }[] = [];
  let host: Events | undefined;
  let current = initialRuntime;
  let authenticated = true;
  let wrongRuntime = false;
  let kernelReady = true;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/api/session") return Response.json({ authenticated: true });
    if (url.pathname === "/api/hosts") return Response.json([]);
    if (request.method === "POST") {
      const body = await request.json();
      requests.push({ path: url.pathname, body });
      if (url.pathname.endsWith("/runtime/experimental/comm"))
        return Response.json(current, { status: 202 });
      return Response.json(
        { success: true },
        { status: url.pathname.endsWith("/auth") && !authenticated ? 401 : 200 },
      );
    }
    let onAbort: () => void;
    let release = () => {};
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const events: Events = {
            signal: request.signal,
            send: (event, data) => {
              if (!request.signal.aborted)
                controller.enqueue(
                  new TextEncoder().encode(
                    `event: ${event}\nid: 1\ndata: ${JSON.stringify(data)}\n\n`,
                  ),
                );
            },
          };
          if (
            url.pathname.endsWith("/marimo/sse") ||
            url.pathname.endsWith("/notebooks/n/events")
          ) {
            activeStreams.add(events);
            peakNotebookStreams = Math.max(peakNotebookStreams, activeStreams.size);
            release = () => {
              activeStreams.delete(events);
            };
            host = events;
          }
          onAbort = () => {
            release();
            controller.close();
          };
          request.signal.addEventListener("abort", onAbort, {
            once: true,
          });
          if (url.pathname.endsWith("/marimo/sse")) {
            Vitest.expect(url.searchParams.get("file")).toBe("/project/n.py");
            marimoStreams.push(events);
            events.send("notebook", { notebook: { ...notebook, operations } });
            events.send("runtime", {
              runtime: wrongRuntime ? { ...current, id: "other" } : current,
            });
            events.send("ready", {});
            if (kernelReady)
              events.send("marimo", {
                marimo: {
                  op: "kernel-ready",
                  ui_values: {},
                  consumer_capabilities: { edit: false, interact: true },
                },
              });
          } else if (url.pathname.endsWith("/notebooks/n/events")) {
            notebookStreams++;
            host = events;
            events.send("notebook", { notebook: { ...notebook, operations } });
            if (current) events.send("runtime", { runtime: current });
            if (operations.includes("runtime.experimental.comm"))
              events.send("custom", {
                custom: {
                  type: "marimo.notification",
                  data: {
                    op: "send-ui-element-message",
                    ui_element: "slider",
                    message: { type: "marimo-ui-value-update", value: 45 },
                  },
                },
                time: "2026-11-12T12:00:00Z",
              });
            events.send("ready", {});
          } else {
            events.send("project", {
              project: {
                id: "p",
                name: "project",
                root: "/project",
                status: "indexed",
                message: null,
                operations: [],
              },
            });
            events.send("ready", {});
          }
        },
        cancel() {
          release();
          request.signal.removeEventListener("abort", onAbort);
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  const registry = AtomRegistry.make();
  const scope = Effect.runSync(Scope.make());
  const model = await Effect.runPromise(
    Effect.gen(function* () {
      const workspace = yield* Workspace.make({});
      return yield* workspace.attach({
        connectionId: "host",
        notebookId: "n",
      });
    }).pipe(
      Effect.provide(Http.layer(fetch)),
      Effect.provideService(AtomRegistry.AtomRegistry, registry),
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  Vitest.onTestFinished(async () => {
    await close();
    registry.dispose();
  });
  await vi.waitFor(() =>
    Vitest.expect(AsyncResult.isSuccess(registry.get(model.state))).toBe(true),
  );
  const subscribe = () => {
    const events: Stream.Success<typeof model.runtime.experimentalComm.events>[] = [];
    const controller = new AbortController();
    const done = Effect.runPromiseExit(
      model.runtime.experimentalComm.events.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      ),
      { signal: controller.signal },
    );
    const stop = async () => {
      controller.abort();
      const exit = await done;
      if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
        throw Cause.squash(exit.cause);
    };
    Vitest.onTestFinished(stop);
    return { events, stop };
  };
  return {
    model,
    registry,
    requests,
    marimoStreams,
    close,
    subscribe,
    notebookStreams: () => notebookStreams,
    peakNotebookStreams: () => peakNotebookStreams,
    custom: (notification: CommProtocol.Notification) =>
      host!.send("custom", {
        custom: { type: "marimo.notification", data: notification },
        time: "2026-11-12T12:00:00Z",
      }),
    ready: () =>
      vi.waitFor(() =>
        Vitest.expect(
          registry.get(model.runtime.experimentalComm.state).connection._tag,
        ).toBe("Connected"),
      ),
    notify: (notification: CommProtocol.Notification) =>
      host!.send("marimo", { marimo: notification }),
    authenticate: (value: boolean) => {
      authenticated = value;
    },
    delayKernelReady: () => {
      kernelReady = false;
    },
    wrongRuntime: () => {
      wrongRuntime = true;
    },
    setOperations: (next: string[]) => {
      operations = next;
      host!.send("notebook", { notebook: { ...notebook, operations } });
    },
    rename: (name: string) =>
      host!.send("notebook", { notebook: { ...notebook, name, operations } }),
    restart: (id: string) => {
      current = { ...runtime, id };
      host!.send("runtime", { runtime: current });
    },
  };
}

Vitest.test(
  "legacy readers replay observed widget state without opening a viewer",
  async () => {
    const f = await fixture();
    Vitest.expect(f.marimoStreams).toHaveLength(0);
    const first = f.subscribe();
    await f.ready();
    f.notify({
      op: "send-ui-element-message",
      ui_element: "a-0",
      message: { type: "marimo-ui-value-update", value: 7 },
    });
    f.notify({
      op: "model-lifecycle",
      model_id: "model",
      message: {
        method: "open",
        state: { x: null, y: 1 },
        buffer_paths: [["x"]],
        buffers: ["AQ=="],
      },
    });
    f.notify({
      op: "model-lifecycle",
      model_id: "model",
      message: {
        method: "update",
        state: { y: 2 },
        buffer_paths: [["x"]],
        buffers: ["Ag=="],
      },
    });
    await vi.waitFor(() =>
      Vitest.expect(
        first.events.filter((event) => event.kind === "notification"),
      ).toHaveLength(4),
    );
    const second = f.subscribe();
    await vi.waitFor(() => Vitest.expect(second.events).toHaveLength(3));
    Vitest.expect(second.events[1]).toMatchObject({
      notification: { op: "kernel-ready", ui_values: { "a-0": 7 } },
    });
    Vitest.expect(second.events[2]).toMatchObject({
      notification: {
        message: {
          method: "open",
          state: { x: null, y: 2 },
          buffers: ["Ag=="],
          buffer_paths: [["x"]],
        },
      },
    });
    await first.stop();
    await second.stop();
    Vitest.expect(f.notebookStreams()).toBe(1);
    Vitest.expect(f.marimoStreams).toHaveLength(0);
    Vitest.expect(f.requests).toEqual([]);
  },
);

Vitest.test(
  "an idle notebook follows startup and edits on its original stream",
  async () => {
    const f = await fixture([], null);
    const reader = f.subscribe();
    await vi.waitFor(() => Vitest.expect(reader.events).toHaveLength(1));
    Vitest.expect(f.marimoStreams).toHaveLength(0);
    f.restart("started");
    await f.ready();
    f.rename("renamed.py");
    await vi.waitFor(() => {
      const state = f.registry.get(f.model.state);
      Vitest.expect(AsyncResult.isSuccess(state) && state.value.notebook?.name).toBe(
        "renamed.py",
      );
    });
    Vitest.expect(f.peakNotebookStreams()).toBe(1);
  },
);

Vitest.test(
  "interrupting a call during viewer startup prevents its POST and closing the notebook releases the viewer",
  async () => {
    const f = await fixture();
    f.delayKernelReady();
    const fiber = Effect.runFork(
      f.model.runtime.experimentalComm.invoke({
        namespace: "table",
        name: "rows",
        args: {},
      }),
    );
    await vi.waitFor(() => Vitest.expect(f.marimoStreams).toHaveLength(1));
    await Effect.runPromise(Fiber.interrupt(fiber));
    await f.close();
    Vitest.expect(f.marimoStreams[0].signal.aborted).toBe(true);
    Vitest.expect(f.requests.map(({ path }) => path)).toEqual([
      "/api/hosts/host/marimo/auth",
    ]);
  },
);

Vitest.test(
  "concurrent legacy writes wait for the same viewer to grant interaction",
  async () => {
    const f = await fixture();
    f.delayKernelReady();
    const send = f.model.runtime.experimentalComm.send({
      _tag: "SetValues",
      values: { slider: 7 },
    });
    const write = () =>
      Vitest.expect(Effect.runPromise(send)).rejects.toMatchObject({
        code: "unsupported",
      });
    const writes = Promise.all([write(), write()]);
    await vi.waitFor(() => Vitest.expect(f.marimoStreams).toHaveLength(1));
    f.notify({
      op: "kernel-ready",
      ui_values: {},
      consumer_capabilities: { edit: false, interact: false },
    });
    await writes;
    Vitest.expect(f.requests.map(({ path }) => path)).toEqual([
      "/api/hosts/host/marimo/auth",
    ]);
    Vitest.expect(f.peakNotebookStreams()).toBe(1);
  },
);

Vitest.test(
  "a marimo close frame fails a pending widget call immediately",
  async () => {
    const f = await fixture();
    f.subscribe();
    await f.ready();
    const call = Vitest.expect(
      Effect.runPromise(
        f.model.runtime.experimentalComm.invoke({
          namespace: "table",
          name: "rows",
          args: {},
        }),
      ),
    ).rejects.toMatchObject({ code: "unavailable" });
    await vi.waitFor(() =>
      Vitest.expect(f.requests.at(-1)?.path).toMatch(/function_call$/),
    );
    f.marimoStreams[0].send("close", { code: 1000 });
    await call;
    Vitest.expect(f.marimoStreams[0].signal.aborted).toBe(true);
  },
);

Vitest.test(
  "RPC waits for its correlated kernel result and UI and widget payloads retain their values",
  async () => {
    const f = await fixture();
    const invoked = Effect.runPromise(
      f.model.runtime.experimentalComm.invoke({
        namespace: "table",
        name: "fetch",
        args: { page: 1 },
        runtimeId: "rt",
      }),
    );
    await vi.waitFor(() =>
      Vitest.expect(
        f.requests.some((request) => request.path.endsWith("function_call")),
      ).toBe(true),
    );
    const call = f.requests.find((request) => request.path.endsWith("function_call"))!;
    const result = {
      op: "function-call-result" as const,
      function_call_id: "unrelated",
      return_value: [1, 2],
      found: true,
      status: { code: "ok" as const, title: null, message: null },
    };
    f.notify({ ...result, return_value: "unrelated" });
    f.notify({ ...result, function_call_id: String(call.body.functionCallId) });
    Vitest.expect(await invoked).toEqual([1, 2]);
    Vitest.expect(f.marimoStreams[0].signal.aborted).toBe(false);
    const reader = f.subscribe();
    await f.ready();
    await Effect.runPromise(
      f.model.runtime.experimentalComm.send({
        _tag: "SetValues",
        runtimeId: "rt",
        values: { "a-0": 5 },
      }),
    );
    await Effect.runPromise(
      f.model.runtime.experimentalComm.send({
        _tag: "Model",
        runtimeId: "rt",
        model: "model",
        message: { method: "update", state: { x: null }, bufferPaths: [["x"]] },
        buffers: ["AQ=="],
      }),
    );
    Vitest.expect(f.requests.at(-2)?.body).toEqual({ objectIds: ["a-0"], values: [5] });
    Vitest.expect(f.requests.at(-1)?.body).toMatchObject({
      modelId: "model",
      buffers: ["AQ=="],
      message: { bufferPaths: [["x"]] },
    });
    await reader.stop();
    Vitest.expect(f.marimoStreams).toHaveLength(1);
    Vitest.expect(f.peakNotebookStreams()).toBe(1);
  },
);

Vitest.test(
  "restart rejects pending RPCs and stale output writes without delivering them to the new kernel",
  async () => {
    const f = await fixture();
    f.subscribe();
    await f.ready();
    const pending = Effect.runPromise(
      f.model.runtime.experimentalComm.invoke({
        runtimeId: "rt",
        namespace: "n",
        name: "f",
        args: {},
      }),
    ).catch((cause: unknown) => cause);
    await vi.waitFor(() =>
      Vitest.expect(
        f.requests.some((request) => request.path.endsWith("function_call")),
      ).toBe(true),
    );
    f.restart("rt2");
    Vitest.expect(await pending).toMatchObject({ code: "stale-runtime" });
    await vi.waitFor(() =>
      Vitest.expect(
        f.registry.get(f.model.runtime.experimentalComm.state).runtime?.id,
      ).toBe("rt2"),
    );
    await f.ready();
    Vitest.expect(f.marimoStreams[0].signal.aborted).toBe(true);
    const before = f.requests.length;
    await Vitest.expect(
      Effect.runPromise(
        f.model.runtime.experimentalComm.send({
          _tag: "SetValues",
          runtimeId: "rt",
          values: { "a-0": 1 },
        }),
      ),
    ).rejects.toMatchObject({ code: "stale-runtime" });
    Vitest.expect(f.requests).toHaveLength(before);
    await f.close();
    Vitest.expect(f.marimoStreams).toHaveLength(1);
    await Vitest.expect(
      Effect.runPromise(
        f.model.runtime.experimentalComm.invoke({
          namespace: "n",
          name: "f",
          args: {},
        }),
      ),
    ).rejects.toMatchObject({ code: "closed" });
  },
);

Vitest.test(
  "marimo authentication failures stay visible until retry and a mismatched runtime stays disconnected",
  async () => {
    const f = await fixture();
    f.authenticate(false);
    const send = f.model.runtime.experimentalComm.send({
      _tag: "SetValues",
      values: { x: 1 },
    });
    await Vitest.expect(Effect.runPromise(send)).rejects.toMatchObject({
      code: "authentication",
    });
    await vi.waitFor(() =>
      Vitest.expect(
        f.registry.get(f.model.runtime.experimentalComm.state).connection,
      ).toMatchObject({
        _tag: "Failed",
        error: { code: "authentication" },
      }),
    );
    Vitest.expect(f.marimoStreams).toHaveLength(0);
    f.authenticate(true);
    f.wrongRuntime();
    await Effect.runPromise(f.model.runtime.experimentalComm.retry);
    await vi.waitFor(() =>
      Vitest.expect(
        f.registry.get(f.model.runtime.experimentalComm.state).connection,
      ).toMatchObject({
        _tag: "Failed",
        error: { code: "stale-runtime" },
      }),
    );
    Vitest.expect(f.marimoStreams.at(-1)?.signal.aborted).toBe(true);
  },
);

Vitest.test(
  "a late renderer restores host widget values without opening a second stream or writing to the kernel",
  async () => {
    const f = await fixture(["runtime.experimental.comm"]);
    const reader = f.subscribe();
    await vi.waitFor(() =>
      Vitest.expect(reader.events).toContainEqual(
        Vitest.expect.objectContaining({
          runtimeId: "rt",
          notification: Vitest.expect.objectContaining({
            op: "kernel-ready",
            ui_values: { slider: 45 },
          }),
        }),
      ),
    );
    Vitest.expect(f.requests).toEqual([]);
    Vitest.expect(f.notebookStreams()).toBe(1);
    Vitest.expect(f.marimoStreams).toHaveLength(0);

    await Effect.runPromise(
      f.model.runtime.experimentalComm.send({
        _tag: "SetValues",
        runtimeId: "rt",
        values: { slider: 8 },
      }),
    );
    Vitest.expect(f.requests).toEqual([
      {
        path: "/api/hosts/host/notebooks/n/runtime/experimental/comm",
        body: { _tag: "SetValues", values: { slider: 8 } },
      },
    ]);
  },
);

Vitest.test(
  "an attached renderer follows a change in the notebook's comm capability",
  async () => {
    const f = await fixture();
    const comm = f.model.runtime.experimentalComm;
    const reader = f.subscribe();
    await f.ready();

    await Effect.runPromise(comm.send({ _tag: "SetValues", values: { slider: 12 } }));
    f.setOperations(["runtime.experimental.comm"]);
    await vi.waitFor(() => Vitest.expect(f.marimoStreams[0].signal.aborted).toBe(true));
    const update = {
      op: "send-ui-element-message",
      ui_element: "slider",
      message: { type: "marimo-ui-value-update", value: 13 },
    } as const;
    f.custom(update);
    await vi.waitFor(() =>
      Vitest.expect(reader.events).toContainEqual({
        kind: "notification",
        runtimeId: "rt",
        notification: update,
      }),
    );
    await Effect.runPromise(comm.send({ _tag: "SetValues", values: { slider: 14 } }));
    Vitest.expect(f.requests.map(({ path }) => path)).toEqual([
      "/api/hosts/host/marimo/auth",
      "/api/hosts/host/marimo/api/kernel/set_ui_element_value",
      "/api/hosts/host/notebooks/n/runtime/experimental/comm",
    ]);
  },
);

Vitest.test(
  "switching to legacy comm retires the pending host call and keeps the mounted reader",
  async () => {
    const f = await fixture(["runtime.experimental.comm"]);
    const comm = f.model.runtime.experimentalComm;
    const reader = f.subscribe();
    const pending = Vitest.expect(
      Effect.runPromise(comm.invoke({ namespace: "table", name: "rows", args: {} })),
    ).rejects.toMatchObject({ code: "stale-runtime" });
    await vi.waitFor(() => Vitest.expect(f.requests).toHaveLength(1));
    const send = comm.send({ _tag: "SetValues", values: { slider: 9 } });

    f.setOperations([]);
    await pending;
    Vitest.expect(f.marimoStreams).toHaveLength(0);
    await f.ready();
    await Effect.runPromise(send);
    Vitest.expect(f.requests.at(-1)).toEqual({
      path: "/api/hosts/host/marimo/api/kernel/set_ui_element_value",
      body: { objectIds: ["slider"], values: [9] },
    });
    const notification = {
      op: "send-ui-element-message",
      ui_element: "slider",
      message: { type: "marimo-ui-value-update", value: 9 },
    } as const;
    f.notify(notification);
    await vi.waitFor(() =>
      Vitest.expect(reader.events).toContainEqual({
        kind: "notification",
        runtimeId: "rt",
        notification,
      }),
    );
    Vitest.expect(f.peakNotebookStreams()).toBe(1);
  },
);

Vitest.test(
  "concurrent Python calls receive their own replies when the kernel answers out of order",
  async () => {
    const f = await fixture(["runtime.experimental.comm"]);
    function invoke(name: string) {
      return Effect.runPromise(
        f.model.runtime.experimentalComm.invoke({ namespace: "table", name, args: {} }),
      );
    }
    const first = invoke("rows");
    const second = Vitest.expect(invoke("columns")).rejects.toMatchObject({
      code: "rpc",
      message: "No columns",
    });
    await vi.waitFor(() => Vitest.expect(f.requests).toHaveLength(2));
    const callId = (name: string) => {
      const call = f.requests.find(({ body }) => body.name === name)?.body.call;
      if (typeof call !== "string") throw new Error(`Missing call ID for ${name}`);
      return call;
    };
    f.custom({
      op: "function-call-result",
      function_call_id: callId("columns"),
      found: true,
      status: { code: "error", title: null, message: "No columns" },
      return_value: null,
    });
    f.custom({
      op: "function-call-result",
      function_call_id: callId("rows"),
      found: true,
      status: { code: "ok", title: null, message: null },
      return_value: [42],
    });
    await Promise.all([Vitest.expect(first).resolves.toEqual([42]), second]);
  },
);

Vitest.test(
  "replacing the host runtime retires pending calls, retained values, and stale widget callbacks",
  async () => {
    const f = await fixture(["runtime.experimental.comm"]);
    const comm = f.model.runtime.experimentalComm;
    const pending = Vitest.expect(
      Effect.runPromise(comm.invoke({ namespace: "table", name: "rows", args: {} })),
    ).rejects.toMatchObject({ code: "stale-runtime" });
    await vi.waitFor(() => Vitest.expect(f.requests).toHaveLength(1));
    f.restart("replacement");
    await pending;
    const reader = f.subscribe();
    await vi.waitFor(() =>
      Vitest.expect(reader.events).toContainEqual(
        Vitest.expect.objectContaining({
          runtimeId: "replacement",
          notification: Vitest.expect.objectContaining({
            op: "kernel-ready",
            ui_values: {},
          }),
        }),
      ),
    );
    await Vitest.expect(
      Effect.runPromise(
        comm.send({ _tag: "SetValues", runtimeId: "rt", values: { slider: 9 } }),
      ),
    ).rejects.toMatchObject({ code: "stale-runtime" });
    Vitest.expect(f.requests).toHaveLength(1);
  },
);
