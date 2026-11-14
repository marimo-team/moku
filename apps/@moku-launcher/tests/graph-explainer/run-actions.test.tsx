import {
  result,
  snapshot as toSnapshot,
  type Observation,
} from "../../../../packages/@moku-core/tests/state.ts";
import { Schema } from "effect";
// @vitest-environment happy-dom
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import * as Notebook from "@moku/core/Notebook";
import * as Protocol from "@moku/core/Protocol";
import { emptyNotebook } from "../../../../packages/@moku-core/src/notebook/state.ts";
import { useRunActions } from "../../src/plugins/graph-explainer/actions.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

async function fixture() {
  const registry = AtomRegistry.make();
  const initial = emptyNotebook();
  initial.ready = true;
  initial.phase = "live";
  initial.notebook = Schema.decodeUnknownSync(Protocol.Notebook)({
    id: "n",
    project_id: "p",
    name: "Pipeline",
    path: "pipeline.py",
    operations: ["runtime.start", "runtime.run"],
    updated_at: null,
  });
  initial.cells.c = Schema.decodeUnknownSync(Protocol.Cell)({
    id: "c",
    notebook_id: "n",
    name: "work",
    code: "x = 1",
    version: 1,
    etag: "before-start",
    code_fingerprint: "v1",
    config: { column: null, disabled: false, hide_code: false, expand_output: false },
  });
  initial.document = Schema.decodeUnknownSync(Protocol.Document)({
    notebook_id: "n",
    order: ["c"],
    app_config: {},
    etag: "v1",
    saved_etag: "v1",
    order_etag: "v1",
    app_config_etag: "v1",
    version: 1,
  });
  const state = Atom.make<Observation>({
    value: initial,
    status: "connected",
    error: null,
    source: { document: null, canEdit: false },
  });
  const kernel = Schema.decodeUnknownSync(Protocol.Runtime)({
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
      Schema.decodeUnknownSync(Protocol.Run)({
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
    id: initial.notebook.id,
    state: Atom.map(state, result),
    ensureRunning: Effect.gen(function* () {
      const initial = registry.get(state).value.runtime;
      if (initial?.status === "running") return;
      yield* start();
      yield* Effect.callback<void, Notebook.ModelError>((resume) => {
        const stop = registry.subscribe(state, (state) => {
          if (state.value.runtime?.status === "running") resume(Effect.void);
          if (state.value.runtime?.status === "failed")
            resume(
              Effect.fail(
                new Notebook.ModelError({
                  reason: "runtime-stopped",
                  message: state.value.runtime.message ?? "Failed",
                }),
              ),
            );
        });
        return Effect.sync(stop);
      });
    }),
    edit: unused,
    save: unused,
    runtime: {
      start,
      restart: unused,
      execute: unused,
      reply: unused,
      run,
      cancel: unused,
      interrupt: unused,
      stop: unused,
    },
  };
  function View() {
    const snapshot = useAtomValue(state);
    const actions = useRunActions(
      notebook,
      toSnapshot(snapshot.value),
      undefined,
      true,
    );
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
  const root = ReactDOMClient.createRoot(element);
  await React.act(async () =>
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
    await React.act(async () => root.unmount());
  };
  Vitest.onTestFinished(async () => {
    await close();
    registry.dispose();
    element.remove();
  });
  const click = () => React.act(async () => element.querySelector("button")!.click());
  const ready = () =>
    React.act(async () => setRuntime({ ...kernel, status: "running" }));
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

Vitest.test(
  "one click starts the kernel, waits, and runs the latest confirmed cells",
  async () => {
    const f = await fixture();
    await f.click();
    Vitest.expect(f.start).toHaveBeenCalledTimes(1);
    Vitest.expect(f.run).not.toHaveBeenCalled();
    Vitest.expect(f.element.querySelector("button")!.textContent).toBe(
      "Starting kernel",
    );
    Vitest.expect(f.element.querySelector("button")!.disabled).toBe(true);
    await React.act(async () =>
      f.registry.update(f.state, (s) => ({
        ...s,
        value: {
          ...s.value,
          cells: {
            c: {
              ...s.value.cells.c,
              etag: Schema.decodeUnknownSync(Protocol.Etag)("after-start"),
            },
          },
        },
      })),
    );
    await f.ready();
    await vi.waitFor(() => Vitest.expect(f.run).toHaveBeenCalledTimes(1));
    Vitest.expect(f.run.mock.calls[0]).toEqual([
      {
        cells: [
          Vitest.expect.objectContaining({
            id: "c",
            etag: Schema.decodeUnknownSync(Protocol.Etag)("after-start"),
          }),
        ],
      },
    ]);
    await f.click();
    Vitest.expect(f.start).toHaveBeenCalledTimes(1);
    Vitest.expect(f.run).toHaveBeenCalledTimes(2);
  },
);

Vitest.test(
  "leaving during startup does not submit a run after the view closes",
  async () => {
    const f = await fixture();
    await f.click();
    await f.close();
    await f.ready();
    Vitest.expect(f.run).not.toHaveBeenCalled();
  },
);

Vitest.test("runs cells in document order with their latest etags", async () => {
  const f = await fixture();
  await f.click();
  await React.act(async () =>
    f.registry.update(f.state, (s) => ({
      ...s,
      value: {
        ...s.value,
        document: Schema.decodeUnknownSync(Protocol.Document)({
          ...s.value.document!,
          order: ["last", "disabled", "c"],
        }),
        cells: {
          c: s.value.cells.c,
          last: Schema.decodeUnknownSync(Protocol.Cell)({
            ...s.value.cells.c,
            id: "last",
            etag: "latest",
          }),
          disabled: Schema.decodeUnknownSync(Protocol.Cell)({
            ...s.value.cells.c,
            id: "disabled",
            config: { ...s.value.cells.c.config, disabled: true },
          }),
        },
      },
    })),
  );
  await f.ready();
  Vitest.expect(f.run.mock.calls[0]).toEqual([
    {
      cells: [
        Vitest.expect.objectContaining({ id: "last", etag: "latest" }),
        Vitest.expect.objectContaining({ id: "disabled" }),
        Vitest.expect.objectContaining({ id: "c", etag: "before-start" }),
      ],
    },
  ]);
});

Vitest.test("an empty document prevents submitting a run", async () => {
  const f = await fixture();
  await f.click();
  await React.act(async () =>
    f.registry.update(f.state, (s) => ({
      ...s,
      value: {
        ...s.value,
        document: Schema.decodeUnknownSync(Protocol.Document)({
          ...s.value.document!,
          order: [],
        }),
        cells: {},
      },
    })),
  );
  await f.ready();
  Vitest.expect(f.run).not.toHaveBeenCalled();
  Vitest.expect(f.element.querySelector('[role="alert"]')!.textContent).toContain(
    "removed",
  );
});

Vitest.test("failed startup reports the error without submitting cells", async () => {
  const f = await fixture();
  await f.click();
  await React.act(async () =>
    f.setRuntime({ ...f.kernel, status: "failed", message: "Kernel exited" }),
  );
  Vitest.expect(f.run).not.toHaveBeenCalled();
  Vitest.expect(f.element.querySelector('[role="alert"]')!.textContent).toContain(
    "Kernel exited",
  );
  await React.act(async () => f.setRuntime(null));
  await f.click();
  Vitest.expect(f.element.querySelector('[role="alert"]')!.textContent).toBe("");
  Vitest.expect(f.element.querySelector("button")!.disabled).toBe(true);
  await f.ready();
  Vitest.expect(f.run).toHaveBeenCalledOnce();
  Vitest.expect(f.element.querySelector("button")!.disabled).toBe(false);
});

Vitest.test("repeated clicks before React renders only start one command", async () => {
  const f = await fixture();
  await React.act(async () => {
    const button = f.element.querySelector("button")!;
    button.click();
    button.click();
  });
  Vitest.expect(f.start).toHaveBeenCalledOnce();
  await f.ready();
  Vitest.expect(f.run).toHaveBeenCalledOnce();
});
