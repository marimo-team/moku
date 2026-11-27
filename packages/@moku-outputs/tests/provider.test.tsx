import { RegistryContext } from "@effect/atom-react";
import { Effect, Queue, Stream } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
// @vitest-environment happy-dom
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";

import type * as RendererSession from "../src/internal/RendererSession.ts";
import { Provider, OutputContext, type Notebook } from "../src/Provider.tsx";

const renderer = vi.hoisted(() => ({ createSession: vi.fn() }));
vi.mock("../src/internal/renderer.ts", () => ({ loadRenderer: async () => renderer }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const cleanup: (() => void)[] = [];
Vitest.afterEach(async () => {
  await React.act(async () => {
    for (const close of cleanup.splice(0)) close();
  });
  renderer.createSession.mockReset();
  document.body.replaceChildren();
});

type Notification = Parameters<RendererSession.Interface["handle"]>[0];
type CommEvent = Stream.Success<Notebook["runtime"]["experimentalComm"]["events"]>;

function fixture() {
  const sessions: {
    options: RendererSession.Options;
    received: Notification[];
    dispose: ReturnType<typeof vi.fn>;
  }[] = [];
  renderer.createSession.mockImplementation((options: RendererSession.Options) => {
    const dispose = vi.fn();
    const received: Notification[] = [];
    sessions.push({ options, dispose, received });
    return {
      runtimeId: options.runtimeId,
      assetUrl: options.assetUrl,
      handle: async (notification: Notification) => {
        received.push(notification);
      },
      dispose,
    };
  });
  let emit: (event: CommEvent) => void = () => {};
  let readers = 0;
  const executeCall = vi.fn(() => ({ answer: 42 }));
  const comm: Notebook["runtime"]["experimentalComm"] = {
    connection: Atom.make({ _tag: "Connected" as const }),
    events: Stream.callback<CommEvent>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          readers++;
          emit = (event) => {
            Queue.offerUnsafe(queue, event);
          };
        }),
        () =>
          Effect.sync(() => {
            readers--;
          }),
      ),
    ),
    invoke: vi.fn(() => Effect.sync(executeCall)),
    send: vi.fn(() => Effect.void),
    retry: Effect.void,
  };
  return {
    runtime: { experimentalComm: comm },
    executeCall,
    assetUrl: (path: string) => path,
    sessions,
    readers: () => readers,
    emit: (event: CommEvent) => emit(event),
    ready: (runtimeId: string) =>
      emit({
        kind: "notification",
        runtimeId,
        notification: { op: "kernel-ready", ui_values: {} },
      }),
  };
}

function Consumer() {
  return <span>{React.useContext(OutputContext)?.runtimeId ?? "disconnected"}</span>;
}
async function mount(node: React.ReactNode) {
  const registry = AtomRegistry.make();
  const element = document.createElement("div");
  document.body.append(element);
  const root = ReactDOMClient.createRoot(element);
  cleanup.push(() => {
    root.unmount();
    registry.dispose();
  });
  const render = async (children: React.ReactNode) => {
    await React.act(async () => {
      root.render(
        <React.StrictMode>
          <RegistryContext.Provider value={registry}>
            {children}
          </RegistryContext.Provider>
        </React.StrictMode>,
      );
    });
  };
  await render(node);
  return { element, render };
}

Vitest.test(
  "providers share an attachment in StrictMode and release it after the last unmount",
  async () => {
    const f = fixture();
    const node = (two: boolean) => (
      <>
        <Provider notebook={f}>
          <Consumer />
        </Provider>
        {two && (
          <Provider notebook={f}>
            <Consumer />
          </Provider>
        )}
      </>
    );
    const view = await mount(node(true));
    await vi.waitFor(() => Vitest.expect(f.readers()).toBe(1));
    await React.act(async () => {
      f.ready("rt");
    });
    Vitest.expect(f.sessions).toHaveLength(1);
    Vitest.expect(view.element.textContent).toBe("rtrt");
    await view.render(node(false));
    Vitest.expect(f.readers()).toBe(1);
    Vitest.expect(f.sessions[0].dispose).not.toHaveBeenCalled();
    await view.render(null);
    await vi.waitFor(() => Vitest.expect(f.readers()).toBe(0));
    Vitest.expect(f.sessions[0].dispose).toHaveBeenCalledOnce();
  },
);

Vitest.test(
  "runtime replacement disposes old renderer state and callbacks retain their producing runtime",
  async () => {
    const f = fixture();
    const view = await mount(
      <Provider notebook={f}>
        <Consumer />
      </Provider>,
    );
    await vi.waitFor(() => Vitest.expect(f.readers()).toBe(1));
    await React.act(async () => {
      f.ready("old");
    });
    const old = f.sessions[0];
    await React.act(async () => {
      f.emit({ kind: "reset", runtimeId: null });
      f.ready("new");
    });
    Vitest.expect(old.dispose).toHaveBeenCalledOnce();
    Vitest.expect(view.element.textContent).toBe("new");
    await old.options.sendComponentValues({ objectIds: ["a"], values: [7] });
    Vitest.expect(f.runtime.experimentalComm.send).toHaveBeenCalledWith(
      {
        _tag: "SetValues",
        runtimeId: "old",
        values: { a: 7 },
      },
      Vitest.expect.any(String),
    );
    const current = f.sessions[1].options;
    Vitest.expect(
      await current.invoke({
        functionCallId: "table-page",
        namespace: "table",
        functionName: "fetch",
        args: {},
      }),
    ).toEqual({ answer: 42 });
    Vitest.expect(f.runtime.experimentalComm.invoke).toHaveBeenCalledWith({
      call: "table-page",
      runtimeId: "new",
      namespace: "table",
      name: "fetch",
      args: {},
    });
    await current.sendModelValue({
      modelId: "m",
      message: { method: "custom", content: {} },
      buffers: ["AQ=="],
    });
    Vitest.expect(f.runtime.experimentalComm.send).toHaveBeenCalledWith(
      {
        _tag: "Model",
        runtimeId: "new",
        model: "m",
        message: { method: "custom", content: {} },
        buffers: ["AQ=="],
      },
      Vitest.expect.any(String),
    );
    await view.render(null);
    await Vitest.expect(
      current.invoke({
        functionCallId: "table-page",
        namespace: "table",
        functionName: "fetch",
        args: {},
      }),
    ).rejects.toThrow("session has ended");
    Vitest.expect(f.executeCall).toHaveBeenCalledTimes(1);
  },
);

Vitest.test(
  "the originating renderer skips its echoed values and model patches",
  async () => {
    const f = fixture();
    await mount(
      <Provider notebook={f}>
        <Consumer />
      </Provider>,
    );
    await vi.waitFor(() => Vitest.expect(f.readers()).toBe(1));
    await React.act(async () => f.ready("rt"));
    const { options, received } = f.sessions[0];
    await options.sendComponentValues({ objectIds: ["a", "b"], values: [1, 2] });
    await options.sendModelValue({
      modelId: "m",
      message: { method: "update", state: { x: null }, bufferPaths: [["x"]] },
      buffers: ["AQ=="],
    });
    const keys = vi
      .mocked(f.runtime.experimentalComm.send)
      .mock.calls.map(([, key]) => {
        if (!key) throw new Error("Missing idempotency key");
        return key;
      });
    Vitest.expect(new Set(keys).size).toBe(2);
    const ui = (id: string, value: number): Notification => ({
      op: "send-ui-element-message",
      ui_element: id,
      message: { type: "marimo-ui-value-update", value },
    });
    const model = (buffer: string): Notification => ({
      op: "model-lifecycle",
      model_id: "m",
      message: {
        method: "update",
        state: { x: null },
        buffer_paths: [["x"]],
        buffers: [buffer],
      },
    });
    const emit = (notification: Notification, requestId?: string) =>
      f.emit({
        kind: "notification",
        runtimeId: "rt",
        notification,
        ...(requestId && { requestId }),
      });
    await React.act(async () => {
      emit(ui("a", 5), "other-slider-write");
      emit(
        {
          op: "model-lifecycle",
          model_id: "m",
          message: {
            method: "update",
            state: { x: null, y: null },
            buffer_paths: [["x"], ["y"]],
            buffers: ["Ag==", "Aw=="],
          },
        },
        "other-model-write",
      );
      emit(model("AQ=="), keys[1]);
      emit(ui("b", 2), keys[0]);
      emit(ui("a", 1), keys[0]);
      emit(ui("a", 3), keys[0]);
      emit(model("Ag=="), keys[1]);
      emit(model("AQ=="), "peer");
      emit(ui("a", 1));
    });
    Vitest.expect(received.slice(1)).toEqual([
      {
        op: "model-lifecycle",
        model_id: "m",
        message: {
          method: "update",
          state: { y: null },
          buffer_paths: [["y"]],
          buffers: ["Aw=="],
        },
      },
      ui("a", 3),
      model("Ag=="),
      model("AQ=="),
      ui("a", 1),
    ]);
    await React.act(async () => {
      f.ready("rt");
      emit(model("AQ=="), keys[1]);
    });
    Vitest.expect(f.sessions).toHaveLength(1);
    Vitest.expect(received.slice(-2)).toEqual([
      { op: "kernel-ready", ui_values: {} },
      model("AQ=="),
    ]);
  },
);

Vitest.test("a second notebook cannot take over the active renderer", async () => {
  const first = fixture();
  const other = fixture();
  const view = await mount(
    <Provider notebook={first}>
      <Consumer />
    </Provider>,
  );
  await vi.waitFor(() => Vitest.expect(first.readers()).toBe(1));
  await React.act(async () => {
    first.ready("first");
  });
  await view.render(
    <>
      <Provider notebook={first}>
        <Consumer />
      </Provider>
      <Provider notebook={other}>
        <Consumer />
      </Provider>
    </>,
  );
  Vitest.expect(view.element.querySelector('[role="alert"]')?.textContent).toContain(
    "one notebook per page",
  );
  Vitest.expect(view.element.textContent).toContain("first");
  Vitest.expect(first.readers()).toBe(1);
  Vitest.expect(other.readers()).toBe(0);
});

Vitest.test(
  "a write without an echo renders the latest peer value 30 seconds after acceptance",
  async () => {
    const f = fixture();
    await mount(
      <Provider notebook={f}>
        <Consumer />
      </Provider>,
    );
    await vi.waitFor(() => Vitest.expect(f.readers()).toBe(1));
    await React.act(async () => f.ready("rt"));
    const { options, received } = f.sessions[0];
    const peer = (value: number): Notification => ({
      op: "send-ui-element-message",
      ui_element: "slider",
      message: { type: "marimo-ui-value-update", value },
    });
    const accepted = Promise.withResolvers<void>();
    vi.mocked(f.runtime.experimentalComm.send).mockReturnValue(
      Effect.promise(() => accepted.promise),
    );
    vi.useFakeTimers();
    try {
      const send = options.sendComponentValues({ objectIds: ["slider"], values: [8] });
      await React.act(async () => {
        for (const value of [5, 6])
          f.emit({
            kind: "notification",
            runtimeId: "rt",
            requestId: "peer",
            notification: peer(value),
          });
      });
      await vi.advanceTimersByTimeAsync(30_000);
      Vitest.expect(received.slice(1)).toEqual([]);
      accepted.resolve();
      await send;
      await vi.advanceTimersByTimeAsync(29_999);
      Vitest.expect(received.slice(1)).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      Vitest.expect(received.slice(1)).toEqual([peer(6)]);
    } finally {
      vi.useRealTimers();
    }
  },
);
