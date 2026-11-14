import { AsyncResult } from "effect/reactivity";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { Effect, Exit, Scope, Stream } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Proxy from "../src/app/Proxy.ts";
import * as Notebook from "../src/app/Notebook.ts";
import type * as Interaction from "@moku/core/Interaction";

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

async function fixture() {
  const native: Events[] = [];
  const requests: {
    path: string;
    body: Record<string, unknown>;
    signal: AbortSignal;
  }[] = [];
  let host: Events | undefined;
  let current = runtime;
  let authenticated = true;
  let wrongRuntime = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method === "POST") {
      const body = await request.json();
      requests.push({ path: url.pathname, body, signal: request.signal });
      return Response.json(
        { success: true },
        { status: url.pathname.endsWith("/auth") && !authenticated ? 401 : 200 },
      );
    }
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
          request.signal.addEventListener("abort", () => controller.close(), {
            once: true,
          });
          if (url.pathname.endsWith("/marimo/sse")) {
            Vitest.expect(url.searchParams.get("file")).toBe("/project/n.py");
            native.push(events);
            events.send("notebook", { notebook });
            events.send("runtime", {
              runtime: wrongRuntime ? { ...current, id: "other" } : current,
            });
            events.send("marimo", {
              marimo: {
                op: "kernel-ready",
                ui_values: {},
                consumer_capabilities: { edit: false, interact: true },
              },
            });
          } else if (url.pathname.endsWith("/notebooks/n/events")) {
            host = events;
            events.send("notebook", { notebook });
            events.send("runtime", { runtime: current });
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
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  const registry = AtomRegistry.make();
  const scope = Effect.runSync(Scope.make());
  const model = await Effect.runPromise(
    Notebook.make(Proxy.make("http://moku.test", { fetch }), {
      connectionId: "host",
      notebookId: "n",
    }).pipe(
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
    const events: Interaction.Event[] = [];
    const controller = new AbortController();
    const done = Effect.runPromise(
      model.runtime.events.pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            events.push(event);
          }),
        ),
      ),
      { signal: controller.signal },
    ).catch(() => {});
    const stop = async () => {
      controller.abort();
      await done;
    };
    Vitest.onTestFinished(stop);
    return { events, stop };
  };
  return {
    model,
    registry,
    requests,
    native,
    close,
    subscribe,
    ready: () =>
      vi.waitFor(() =>
        Vitest.expect(registry.get(model.runtime.state).connection._tag).toBe(
          "Connected",
        ),
      ),
    notify: (notification: Interaction.Notification) =>
      native.at(-1)!.send("marimo", { marimo: notification }),
    authenticate: (value: boolean) => {
      authenticated = value;
    },
    wrongRuntime: () => {
      wrongRuntime = true;
    },
    restart: (id: string) => {
      current = { ...runtime, id };
      host!.send("runtime", { runtime: current });
    },
  };
}

Vitest.test(
  "readers share one lazy attachment and late readers receive current widget state",
  async () => {
    const f = await fixture();
    Vitest.expect(Atom.isWritable(f.model.runtime.state)).toBe(false);
    Vitest.expect(f.native).toHaveLength(0);
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
      message: { method: "update", state: { y: 2 }, buffer_paths: [], buffers: [] },
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
          buffers: ["AQ=="],
          buffer_paths: [["x"]],
        },
      },
    });
    Vitest.expect(f.native).toHaveLength(1);
    await first.stop();
    Vitest.expect(f.native[0].signal.aborted).toBe(false);
    await second.stop();
    Vitest.expect(f.native[0].signal.aborted).toBe(true);
  },
);

Vitest.test(
  "RPC waits for its correlated kernel result and UI and widget payloads retain their values",
  async () => {
    const f = await fixture();
    const invoked = Effect.runPromise(
      f.model.runtime.invoke({
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
    let resolved = false;
    void invoked.then(() => {
      resolved = true;
    });
    const result = {
      op: "function-call-result" as const,
      function_call_id: "unrelated",
      return_value: [1, 2],
      found: true,
      status: { code: "ok" as const, title: null, message: null },
    };
    f.notify(result);
    await new Promise((resolve) => setTimeout(resolve, 0));
    Vitest.expect(resolved).toBe(false);
    f.notify({ ...result, function_call_id: String(call.body.functionCallId) });
    Vitest.expect(await invoked).toEqual([1, 2]);
    Vitest.expect(f.native[0].signal.aborted).toBe(true);
    const reader = f.subscribe();
    await f.ready();
    await Effect.runPromise(
      f.model.runtime.setUIValues({ runtimeId: "rt", values: { "a-0": 5 } }),
    );
    await Effect.runPromise(
      f.model.runtime.sendWidgetMessage({
        runtimeId: "rt",
        modelId: "model",
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
  },
);

Vitest.test(
  "restart rejects pending RPCs and stale output writes without delivering them to the new kernel",
  async () => {
    const f = await fixture();
    f.subscribe();
    await f.ready();
    const pending = Effect.runPromise(
      f.model.runtime.invoke({ runtimeId: "rt", namespace: "n", name: "f", args: {} }),
    ).catch((cause: unknown) => cause);
    await vi.waitFor(() =>
      Vitest.expect(
        f.requests.some((request) => request.path.endsWith("function_call")),
      ).toBe(true),
    );
    f.restart("rt2");
    Vitest.expect(await pending).toMatchObject({ code: "stale-runtime" });
    await vi.waitFor(() => Vitest.expect(f.native).toHaveLength(2));
    await f.ready();
    Vitest.expect(f.native[0].signal.aborted).toBe(true);
    const before = f.requests.length;
    await Vitest.expect(
      Effect.runPromise(
        f.model.runtime.setUIValues({ runtimeId: "rt", values: { "a-0": 1 } }),
      ),
    ).rejects.toMatchObject({ code: "stale-runtime" });
    Vitest.expect(f.requests).toHaveLength(before);
    await f.close();
    Vitest.expect(f.native[1].signal.aborted).toBe(true);
    await Vitest.expect(
      Effect.runPromise(
        f.model.runtime.invoke({ namespace: "n", name: "f", args: {} }),
      ),
    ).rejects.toMatchObject({ code: "closed" });
  },
);

Vitest.test(
  "native authentication failures stay visible until retry; an incorrect runtime never becomes interactive",
  async () => {
    const f = await fixture();
    f.authenticate(false);
    f.subscribe();
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(f.model.runtime.state).connection).toMatchObject({
        _tag: "Failed",
        error: { code: "authentication" },
      }),
    );
    Vitest.expect(f.native).toHaveLength(0);
    f.authenticate(true);
    await Effect.runPromise(f.model.runtime.retry);
    await f.ready();
    f.wrongRuntime();
    await Effect.runPromise(f.model.runtime.retry);
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(f.model.runtime.state).connection).toMatchObject({
        _tag: "Failed",
        error: { code: "stale-runtime" },
      }),
    );
    Vitest.expect(f.native.at(-1)?.signal.aborted).toBe(true);
  },
);
