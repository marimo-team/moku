// @vitest-environment happy-dom
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Effect, Queue, Stream } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import type * as Interaction from "@moku/core/Interaction";
import { Provider, OutputContext, type Notebook } from "../src/Provider.tsx";
import type { SessionOptions } from "../src/internal/session.ts";

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

function fixture() {
  const sessions: { options: SessionOptions; dispose: ReturnType<typeof vi.fn> }[] = [];
  renderer.createSession.mockImplementation((options: SessionOptions) => {
    const dispose = vi.fn();
    sessions.push({ options, dispose });
    return {
      runtimeId: options.runtimeId,
      assetUrl: options.assetUrl,
      handle: async () => {},
      dispose,
    };
  });
  let emit: (event: Interaction.Event) => void = () => {};
  let readers = 0;
  const runtime: Notebook["runtime"] = {
    state: Atom.readable(() => ({
      runtime: null,
      connection: "connected",
      canInteract: true,
      error: null,
    })),
    events: Stream.callback<Interaction.Event>((queue) =>
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
    invoke: vi.fn(() => Effect.succeed({ answer: 42 })),
    setUIValues: vi.fn(() => Effect.void),
    sendWidgetMessage: vi.fn(() => Effect.void),
    assetUrl: (path) => path,
    retry: Effect.void,
  };
  return {
    runtime,
    sessions,
    readers: () => readers,
    emit: (event: Interaction.Event) => emit(event),
    ready: (runtimeId: string) =>
      emit({
        kind: "notification",
        runtimeId,
        notification: { op: "kernel-ready", ui_values: {} },
      }),
  };
}

function Consumer() {
  return (
    <span>{React.useContext(OutputContext).session?.runtimeId ?? "disconnected"}</span>
  );
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
    Vitest.expect(f.runtime.setUIValues).toHaveBeenCalledWith({
      runtimeId: "old",
      values: { a: 7 },
    });
    const current = f.sessions[1].options;
    Vitest.expect(
      await current.invoke({ namespace: "table", name: "fetch", args: {} }),
    ).toEqual({ answer: 42 });
    Vitest.expect(f.runtime.invoke).toHaveBeenCalledWith({
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
    Vitest.expect(f.runtime.sendWidgetMessage).toHaveBeenCalledWith({
      runtimeId: "new",
      modelId: "m",
      message: { method: "custom", content: {} },
      buffers: ["AQ=="],
    });
    await view.render(null);
    await Vitest.expect(
      current.invoke({ namespace: "table", name: "fetch", args: {} }),
    ).rejects.toBeDefined();
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
