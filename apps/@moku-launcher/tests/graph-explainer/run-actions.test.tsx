// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Effect, Stream } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import type * as Notebook from "@moku/core/Notebook";
import * as Protocol from "@moku/core/Protocol";
import { emptyNotebook } from "../../../../packages/@moku-core/src/notebook/state.ts";
import { useRunActions } from "../../src/plugins/graph-explainer/actions.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

async function fixture() {
  const registry = AtomRegistry.make();
  const initial = emptyNotebook();
  initial.ready = true;
  initial.phase = "live";
  initial.notebook = Protocol.Notebook.parse({
    id: "n",
    project_id: "p",
    name: "Pipeline",
    path: "pipeline.py",
    operations: ["runtime.start", "runtime.run"],
    updated_at: null,
  });
  initial.cells.c = Protocol.Cell.parse({
    id: "c",
    notebook_id: "n",
    name: "work",
    code: "x = 1",
    version: 1,
    etag: "before-start",
    code_fingerprint: "v1",
    config: { column: null, disabled: false, hide_code: false, expand_output: false },
  });
  initial.document = Protocol.Document.parse({
    notebook_id: "n",
    order: ["c"],
    app_config: {},
    etag: "v1",
    saved_etag: "v1",
    order_etag: "v1",
    app_config_etag: "v1",
    version: 1,
  });
  const state = Atom.make<Notebook.State>({
    value: initial,
    status: "connected",
    error: null,
    source: { document: null, canEdit: false },
  });
  const kernel = Protocol.Runtime.parse({
    id: "rt",
    notebook_id: "n",
    status: "starting",
    started_at: "2026-11-12T12:00:00Z",
    marimo_version: "0.25.2",
    message: null,
  });
  const setRuntime = (runtime: Protocol.RuntimeOutput | null) =>
    registry.update(state, (s) => ({ ...s, value: { ...s.value, runtime } }));
  const start = vi.fn(() =>
    Effect.sync(() => {
      setRuntime(kernel);
      return kernel;
    }),
  );
  const run = vi.fn(() =>
    Effect.succeed(
      Protocol.Run.parse({
        id: "run",
        notebook_id: "n",
        runtime_id: "rt",
        cells: ["c"],
        status: "queued",
        outcome: null,
        started_at: null,
        completed_at: null,
      }),
    ),
  );
  const unused = () => Effect.die("Unexpected operation");
  const notebook: Notebook.Interface = {
    target: { connectionId: "host", notebookId: "n" },
    state,
    edit: unused,
    save: unused,
    runtime: {
      start,
      run,
      cancel: unused,
      interrupt: unused,
      stop: unused,
      state: Atom.make({
        runtime: null,
        connection: "idle",
        canInteract: false,
        error: null,
      }),
      events: Stream.empty,
      setUIValues: unused,
      invoke: unused,
      sendWidgetMessage: unused,
      assetUrl: (path) => path,
      retry: Effect.void,
    },
  };
  function View() {
    const snapshot = useAtomValue(state);
    const actions = useRunActions(notebook, snapshot.value, undefined, true);
    return (
      <>
        <button
          disabled={!!actions.disabledReason}
          onClick={() => actions.action("run")}
        >
          {actions.actionLabel}
        </button>
        <p role="alert">{actions.actionError}</p>
      </>
    );
  }
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  await act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <View />
      </RegistryContext.Provider>,
    ),
  );
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await act(async () => root.unmount());
  };
  onTestFinished(async () => {
    await close();
    registry.dispose();
    element.remove();
  });
  const click = () => act(async () => element.querySelector("button")!.click());
  const ready = () => act(async () => setRuntime({ ...kernel, status: "running" }));
  return {
    element,
    registry,
    state,
    kernel,
    start,
    run,
    click,
    ready,
    close,
    setRuntime,
  };
}

test("one click starts the kernel, waits, and runs the latest confirmed cells", async () => {
  const f = await fixture();
  await f.click();
  expect(f.start).toHaveBeenCalledTimes(1);
  expect(f.run).not.toHaveBeenCalled();
  expect(f.element.querySelector("button")!.textContent).toBe("Starting kernel");
  expect(f.element.querySelector("button")!.disabled).toBe(true);
  await act(async () =>
    f.registry.update(f.state, (s) => ({
      ...s,
      value: {
        ...s.value,
        cells: { c: { ...s.value.cells.c, etag: "after-start" } },
      },
    })),
  );
  await f.ready();
  await vi.waitFor(() => expect(f.run).toHaveBeenCalledTimes(1));
  expect(f.run.mock.calls[0]).toEqual([
    {
      request: { cells: [{ id: "c", etag: "after-start" }] },
      requestId: expect.any(String),
    },
  ]);
  await f.click();
  expect(f.start).toHaveBeenCalledTimes(1);
  expect(f.run).toHaveBeenCalledTimes(2);
});

test("leaving during startup does not submit a run after the view closes", async () => {
  const f = await fixture();
  await f.click();
  await f.close();
  await f.ready();
  expect(f.run).not.toHaveBeenCalled();
});

test("failed startup reports the error without submitting cells", async () => {
  const f = await fixture();
  await f.click();
  await act(async () =>
    f.setRuntime({ ...f.kernel, status: "failed", message: "Kernel exited" }),
  );
  expect(f.run).not.toHaveBeenCalled();
  expect(f.element.querySelector('[role="alert"]')!.textContent).toContain(
    "Kernel exited",
  );
  await act(async () => f.setRuntime(null));
  await f.click();
  expect(f.element.querySelector('[role="alert"]')!.textContent).toBe("");
  expect(f.element.querySelector("button")!.disabled).toBe(true);
  await f.ready();
  expect(f.run).toHaveBeenCalledOnce();
  expect(f.element.querySelector("button")!.disabled).toBe(false);
});

test("repeated clicks before React renders only start one command", async () => {
  const f = await fixture();
  await act(async () => {
    const button = f.element.querySelector("button")!;
    button.click();
    button.click();
  });
  expect(f.start).toHaveBeenCalledOnce();
  await f.ready();
  expect(f.run).toHaveBeenCalledOnce();
});
