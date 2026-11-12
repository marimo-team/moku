import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { Effect, Exit, Layer, Scope } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Model from "../src/index.ts";
import * as Notebook from "../src/Notebook.ts";
import * as Workspace from "../src/Workspace.ts";
import * as Protocol from "../src/Protocol.ts";
import * as Runtime from "../src/Runtime.ts";

const notebook = {
  id: "n",
  project_id: "p",
  name: "demo.py",
  path: "demo.py",
  operations: ["notebook.edit", "runtime.run"],
  updated_at: null,
};
const cell = Protocol.Cell.parse({
  id: "a",
  notebook_id: "n",
  code: "x = 1",
  name: "_",
  config: { column: null, disabled: false, hide_code: false, expand_output: false },
  etag: "cell-1",
  code_fingerprint: "code-1",
  version: 1,
});
const document = Protocol.Document.parse({
  notebook_id: "n",
  order: ["a"],
  app_config: {},
  etag: "doc-1",
  saved_etag: "doc-1",
  order_etag: "order",
  app_config_etag: "config",
  version: 1,
});
const runtime = {
  id: "rt",
  notebook_id: "n",
  status: "running",
  message: null,
  marimo_version: null,
  started_at: "2026-11-11T12:00:00Z",
};
const runRecord = {
  id: "run-1",
  notebook_id: "n",
  runtime_id: "rt",
  cells: ["a"],
  status: "running",
  outcome: null,
  started_at: null,
  completed_at: null,
};

interface TestStream {
  request: Request;
  closed: boolean;
  send: (event: string, data: unknown, id?: string) => void;
  end: () => void;
}

async function fixture(start?: () => Promise<Response>) {
  const requests: Request[] = [];
  const streams: TestStream[] = [];
  const connections = [
    { id: "local", name: "local", url: "http://host/api/marimo/v1", source: "local" },
  ];
  let holdCommands = false;
  let refuseCommands = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (path === "/api/session") return Response.json({ authenticated: true });
    if (path === "/api/hosts") {
      if (request.method === "GET") return Response.json(connections);
      const input = await request.json();
      const connected = {
        id: "manual",
        name: "manual",
        url: input.url,
        source: "manual",
      };
      connections.push(connected);
      return Response.json(connected, { status: 201 });
    }
    if (path.endsWith("/events")) {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const stream: TestStream = {
        request,
        closed: false,
        send: (event, data, id) =>
          controller.enqueue(
            new TextEncoder().encode(
              `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          ),
        end: () => {
          stream.closed = true;
          controller.close();
        },
      };
      const body = new ReadableStream<Uint8Array>({
        start: (value) => {
          controller = value;
        },
        cancel: () => {
          stream.closed = true;
        },
      });
      request.signal.addEventListener(
        "abort",
        () => {
          if (!stream.closed) {
            stream.closed = true;
            controller.error(new DOMException("Aborted", "AbortError"));
          }
        },
        { once: true },
      );
      streams.push(stream);
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (holdCommands)
      return new Promise<Response>((_resolve, reject) =>
        request.signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        ),
      );
    if (refuseCommands)
      return Response.json(
        { type: "urn:marimo:problem:no-runtime", title: "No runtime", status: 409 },
        { status: 409, headers: { "Content-Type": "application/problem+json" } },
      );
    if (path.endsWith("/edits") || path.endsWith("/save"))
      return Response.json({ document, cells: {} });
    if (path.endsWith("/runtime") && request.method === "PUT" && start) return start();
    return Response.json(path.includes("/runs") ? runRecord : runtime, { status: 202 });
  };
  const registry = AtomRegistry.make();
  const scope = await Effect.runPromise(Scope.make());
  const layer = Model.layer("http://moku.test", { fetch });
  type Env = Layer.Success<typeof layer> | AtomRegistry.AtomRegistry | Scope.Scope;
  const run = <A, E>(effect: Effect.Effect<A, E, Env>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(layer),
        Effect.provideService(AtomRegistry.AtomRegistry, registry),
        Effect.provideService(Scope.Scope, scope),
      ),
    );
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  Vitest.onTestFinished(async () => {
    await close();
    registry.dispose();
  });
  const attach = (connectionId = "host-a") =>
    run(Notebook.make({ connectionId, notebookId: "n" }));
  const stream = async (index = 0) => {
    await vi.waitFor(() => Vitest.expect(streams.length).toBeGreaterThan(index), {
      timeout: 3000,
      interval: 10,
    });
    return streams[index];
  };
  return {
    registry,
    run,
    attach,
    stream,
    streams,
    requests,
    close,
    hold: () => {
      holdCommands = true;
    },
    refuse: () => {
      refuseCommands = true;
    },
  };
}

function snapshot(stream: TestStream) {
  stream.send("notebook", { notebook });
  stream.send("cell", { cell });
  stream.send("document", { document });
  stream.send("ready", {}, "1");
}

const settled = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

Vitest.test(
  "workspace authenticates, shares catalog atoms, and refreshes after manual connections",
  async () => {
    const f = await fixture();
    const workspace = await f.run(Workspace.make({ launchKey: "launch-key" }));
    Vitest.expectTypeOf(workspace.state).not.toExtend<Atom.Writable<Workspace.State>>();
    Vitest.expect(Atom.isWritable(workspace.state)).toBe(false);
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(workspace.state).connections).toHaveLength(1),
    );
    Vitest.expect(f.requests[0].headers.get("authorization")).toBe("Bearer launch-key");
    const catalog = workspace.catalog("local");
    Vitest.expect(Atom.isWritable(catalog)).toBe(false);
    Vitest.expect(workspace.catalog("local")).toBe(catalog);
    Vitest.expect(f.streams).toHaveLength(0);
    const unmount = f.registry.mount(catalog);
    const stream = await f.stream();
    stream.send("notebook", { notebook });
    stream.send("ready", {}, "1");
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(catalog).value.ready).toBe(true),
    );
    Vitest.expect(f.registry.get(catalog).value.notebooks.n.name).toBe("demo.py");
    stream.send("reset", {});
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(catalog).value.notebooks).toEqual({}),
    );
    await f.run(
      workspace.connect({ url: "http://manual/api/marimo/v1", token: "secret" }),
    );
    Vitest.expect(f.registry.get(workspace.state).connections).toHaveLength(2);
    Vitest.expect(
      JSON.stringify(f.registry.get(workspace.state).connections),
    ).not.toContain("secret");
    await f.run(workspace.refresh);
    Vitest.expect(f.registry.get(workspace.state).connections).toHaveLength(2);
    Vitest.expect(f.registry.get(workspace.state).status).toEqual({
      pending: false,
      error: null,
    });
    unmount();
    await vi.waitFor(() => Vitest.expect(stream.closed).toBe(true));
  },
);

Vitest.test(
  "only coherent document revisions become editable; output replacement, removal, and reset remain intact",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    Vitest.expectTypeOf(handle.state).not.toExtend<Atom.Writable<Notebook.State>>();
    Vitest.expect(Atom.isWritable(handle.state)).toBe(false);
    const stream = await f.stream();
    stream.send("notebook", { notebook });
    stream.send("cell", { cell });
    stream.send("document", { document });
    await settled();
    Vitest.expect(f.registry.get(handle.state).source).toEqual({
      document: null,
      canEdit: false,
    });
    stream.send("ready", {}, "1");
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).source.canEdit).toBe(true),
    );
    stream.send(
      "cell",
      { cell: { ...cell, version: 2, code: "x = 2", etag: "cell-2" } },
      "2",
    );
    await settled();
    Vitest.expect(
      f.registry.get(handle.state).source.document?.cells.get("a")?.code,
    ).toBe("x = 1");
    stream.send(
      "document",
      { document: { ...document, version: 2, etag: "doc-2" } },
      "3",
    );
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).source.document?.revision.etag).toBe(
        "doc-2",
      ),
    );
    Vitest.expect(f.registry.get(handle.state).value.cells.a.code).toBe("x = 2");
    stream.send(
      "analysis",
      {
        analysis: {
          notebook_id: "n",
          document_etag: "doc-2",
          cells: { a: { defs: ["x"], refs: [], errors: [] } },
        },
      },
      "4",
    );
    stream.send("run", { run: runRecord }, "5");
    stream.send(
      "console",
      {
        console: {
          id: "log",
          execution_id: "exec",
          seq: 1,
          name: "stdout",
          text: "first",
        },
      },
      "6",
    );
    stream.send(
      "console",
      {
        console: {
          id: "log",
          execution_id: "exec",
          seq: 1,
          name: "stdout",
          text: "replacement",
        },
      },
      "7",
    );
    stream.send(
      "input",
      {
        input: {
          id: "input",
          execution_id: "exec",
          seq: 2,
          prompt: "?",
          password: false,
          status: "pending",
        },
      },
      "8",
    );
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).value.inputs.input?.status).toBe(
        "pending",
      ),
    );
    Vitest.expect(f.registry.get(handle.state).value.analysis?.document_etag).toBe(
      "doc-2",
    );
    Vitest.expect(f.registry.get(handle.state).value.runs["run-1"].id).toBe("run-1");
    Vitest.expect(
      Object.values(f.registry.get(handle.state).value.consoles).map(
        (item) => item.text,
      ),
    ).toEqual(["replacement"]);
    stream.send("execution.removed", { id: "exec" }, "9");
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).value.consoles).toEqual({}),
    );
    Vitest.expect(f.registry.get(handle.state).value.inputs).toEqual({});
    stream.send("reset", {});
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).source.document).toBeNull(),
    );
    Vitest.expect(f.registry.get(handle.state).source.canEdit).toBe(false);
    Vitest.expect(f.registry.get(handle.state).value.runs).toEqual({});
  },
);

Vitest.test(
  "replay retains the confirmed revision but disables editing until ready; reset discards its cursor",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const first = await f.stream();
    snapshot(first);
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).source.canEdit).toBe(true),
    );
    first.end();
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).status).toBe("reconnecting"),
    );
    Vitest.expect(f.registry.get(handle.state).source.canEdit).toBe(false);
    Vitest.expect(f.registry.get(handle.state).source.document?.revision.etag).toBe(
      "doc-1",
    );
    const second = await f.stream(1);
    Vitest.expect(second.request.headers.get("last-event-id")).toBe("1");
    second.send("ready", {}, "2");
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).source.canEdit).toBe(true),
    );
    second.send("reset", {}, "2");
    second.send("cell", { cell });
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).source.document).toBeNull(),
    );
    second.end();
    const third = await f.stream(2);
    Vitest.expect(third.request.headers.get("last-event-id")).toBeNull();
    snapshot(third);
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).source.canEdit).toBe(true),
    );
  },
  10000,
);

Vitest.test(
  "attachments isolate identical notebook IDs and stop on incoherent document events",
  async () => {
    const f = await fixture();
    const first = await f.attach("host-a");
    const second = await f.attach("host-b");
    const streamA = await f.stream(0);
    const streamB = await f.stream(1);
    snapshot(streamA);
    snapshot(streamB);
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(second.state).source.canEdit).toBe(true),
    );
    streamA.send(
      "document",
      { document: { ...document, order: ["missing"], version: 2 } },
      "2",
    );
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(first.state).status).toBe("error"),
    );
    Vitest.expect(f.registry.get(first.state).source.canEdit).toBe(false);
    Vitest.expect(f.registry.get(first.state).error?.message).toContain("do not match");
    Vitest.expect(streamA.closed).toBe(true);
    Vitest.expect(f.registry.get(second.state).source.canEdit).toBe(true);
    const wrongRegistry = AtomRegistry.make();
    try {
      Vitest.expect(() => wrongRegistry.get(second.state)).toThrow("AtomRegistry");
    } finally {
      wrongRegistry.dispose();
    }
    await f.close();
    Vitest.expect(streamB.closed).toBe(true);
  },
);

Vitest.test(
  "bound commands preserve preconditions, distinguish cancel from interrupt, and abort on scope close",
  async () => {
    const f = await fixture();
    const handle = await f.attach("host /a");
    await f.stream();
    await f.run(
      handle.edit({
        request: {
          changes: [
            { kind: "put_cell", base_etag: "cell-1", cell: { id: "a", code: "x = 2" } },
          ],
        },
        requestId: "edit-key",
      }),
    );
    await f.run(
      handle.save({
        etag: "doc-1",
        requestId: "save-key",
        decisions: { overwrite: "yes" },
      }),
    );
    await f.run(
      handle.runtime.start({ requestId: "start-key", decisions: { start: "yes" } }),
    );
    await f.run(
      handle.runtime.run({
        request: { cells: [{ id: "a", etag: "cell-1" }] },
        requestId: "run-key",
      }),
    );
    await f.run(handle.runtime.cancel({ runId: "run /1", requestId: "cancel-key" }));
    await f.run(handle.runtime.interrupt({ requestId: "interrupt-key" }));
    await f.run(handle.runtime.stop({ requestId: "stop-key" }));
    const commands = f.requests.filter((request) => request.method !== "GET");
    Vitest.expect(
      commands.map((request) => [
        request.method,
        new URL(request.url).pathname.replace("/api/hosts/host%20%2Fa/notebooks/n", ""),
        request.headers.get("idempotency-key"),
      ]),
    ).toEqual([
      ["POST", "/edits", "edit-key"],
      ["POST", "/save", "save-key"],
      ["PUT", "/runtime", "start-key"],
      ["POST", "/runtime/runs", "run-key"],
      ["DELETE", "/runtime/runs/run%20%2F1", "cancel-key"],
      ["POST", "/runtime/interrupt", "interrupt-key"],
      ["DELETE", "/runtime", "stop-key"],
    ]);
    Vitest.expect(commands[1].headers.get("if-match")).toBe("doc-1");
    Vitest.expect(await commands[0].json()).toEqual({
      changes: [
        {
          kind: "put_cell",
          base_etag: "cell-1",
          cell: { id: "a", code: "x = 2", name: "_" },
        },
      ],
    });
    Vitest.expect(await commands[1].json()).toEqual({
      decisions: { overwrite: "yes" },
    });
    Vitest.expect(await commands[2].json()).toEqual({ decisions: { start: "yes" } });
    Vitest.expect(await commands[3].json()).toEqual({
      cells: [{ id: "a", etag: "cell-1" }],
    });
    f.refuse();
    await Vitest.expect(
      f.run(handle.runtime.interrupt({ requestId: "refused" })),
    ).rejects.toMatchObject({
      status: 409,
      problem: { type: "urn:marimo:problem:no-runtime" },
    });
    f.hold();
    const pending = f.run(handle.save({ etag: "doc-1", requestId: "held" })).then(
      () => "accepted",
      () => "aborted",
    );
    await vi.waitFor(() =>
      Vitest.expect(f.requests.at(-1)?.headers.get("idempotency-key")).toBe("held"),
    );
    await f.close();
    Vitest.expect(await pending).toBe("aborted");
    Vitest.expect(f.streams.every((stream) => stream.closed)).toBe(true);
  },
);

Vitest.test.each(["running", "failed", "removed"] as const)(
  "runtime startup retains %s observed before the command response",
  async (outcome) => {
    const response = Promise.withResolvers<Response>();
    const start = vi.fn(() => response.promise);
    const f = await fixture(start);
    const handle = await f.attach();
    const stream = await f.stream();
    snapshot(stream);
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).value.ready).toBe(true),
    );
    const result = f.run(Runtime.ensureRunning(handle)).then(
      (value) => value,
      (error: Error) => error.message,
    );
    await vi.waitFor(() => Vitest.expect(start).toHaveBeenCalledOnce());
    stream.send("runtime", { runtime: { ...runtime, status: "starting" } }, "2");
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).value.runtime?.status).toBe(
        "starting",
      ),
    );
    if (outcome === "removed") {
      stream.send("runtime.removed", { id: runtime.id }, "3");
    } else {
      stream.send(
        "runtime",
        { runtime: { ...runtime, status: outcome, message: "Startup failed" } },
        "3",
      );
    }
    await vi.waitFor(() =>
      Vitest.expect(
        f.registry.get(handle.state).value.runtime?.status ?? "removed",
      ).toBe(outcome),
    );
    // Even a successful HTTP response must not revive a removed runtime.
    response.resolve(
      Response.json(
        { ...runtime, status: outcome === "removed" ? "running" : "starting" },
        { status: 202 },
      ),
    );
    Vitest.expect(await result).toBe(
      outcome === "failed" ? "Startup failed" : outcome === "running",
    );
  },
);

Vitest.test(
  "runtime startup waits for its identity after the command response",
  async () => {
    const start = vi.fn(async () =>
      Response.json({ ...runtime, status: "starting" }, { status: 202 }),
    );
    const f = await fixture(start);
    const handle = await f.attach();
    const stream = await f.stream();
    snapshot(stream);
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).value.ready).toBe(true),
    );
    let complete = false;
    const result = f.run(Runtime.ensureRunning(handle)).then((value) => {
      complete = true;
      return value;
    });
    await vi.waitFor(() => Vitest.expect(start).toHaveBeenCalledOnce());
    stream.send("runtime", { runtime: { ...runtime, id: "unrelated" } }, "2");
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).value.runtime?.id).toBe("unrelated"),
    );
    await settled();
    Vitest.expect(complete).toBe(false);
    stream.send("runtime", { runtime }, "3");
    Vitest.expect(await result).toBe(true);
  },
);

Vitest.test(
  "runtime startup accepts a running response after an earlier starting event",
  async () => {
    const response = Promise.withResolvers<Response>();
    const start = vi.fn(() => response.promise);
    const f = await fixture(start);
    const handle = await f.attach();
    const stream = await f.stream();
    snapshot(stream);
    const result = f.run(Runtime.ensureRunning(handle));
    await vi.waitFor(() => Vitest.expect(start).toHaveBeenCalledOnce());
    stream.send("runtime", { runtime: { ...runtime, status: "starting" } }, "2");
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).value.runtime?.status).toBe(
        "starting",
      ),
    );
    response.resolve(Response.json(runtime, { status: 202 }));
    Vitest.expect(await result).toBe(true);
  },
);

Vitest.test(
  "runtime startup joins an existing start and reuses a running runtime",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const stream = await f.stream();
    snapshot(stream);
    stream.send("runtime", { runtime: { ...runtime, status: "starting" } }, "2");
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).value.runtime?.status).toBe(
        "starting",
      ),
    );
    const result = f.run(Runtime.ensureRunning(handle));
    await settled();
    stream.send("runtime", { runtime }, "3");
    Vitest.expect(await result).toBe(true);
    Vitest.expect(await f.run(Runtime.ensureRunning(handle))).toBe(true);
    Vitest.expect(
      f.requests.filter((request) => request.method === "PUT"),
    ).toHaveLength(0);
  },
);

Vitest.test.each(["interruption", "timeout"] as const)(
  "runtime startup releases observation on %s",
  async (end) => {
    const start = vi.fn(async () =>
      Response.json({ ...runtime, status: "starting" }, { status: 202 }),
    );
    const f = await fixture(start);
    const handle = await f.attach();
    const stream = await f.stream();
    snapshot(stream);
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(handle.state).value.ready).toBe(true),
    );
    const released = vi.fn();
    const state = Atom.readable((get) => {
      get.addFinalizer(released);
      return get(handle.state);
    });
    const controller = new AbortController();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const result = Effect.runPromise(
        Runtime.ensureRunning({ ...handle, state }).pipe(
          Effect.provideService(AtomRegistry.AtomRegistry, f.registry),
        ),
        { signal: controller.signal },
      ).then(
        () => "succeeded",
        (error: { _tag?: string }) => error._tag ?? "interrupted",
      );
      await vi.waitFor(() => Vitest.expect(start).toHaveBeenCalledOnce());
      Vitest.expect(released).not.toHaveBeenCalled();
      if (end === "timeout") await vi.advanceTimersByTimeAsync(60_000);
      else controller.abort();
      Vitest.expect(await result).toBe(
        end === "timeout" ? "TimeoutError" : "interrupted",
      );
      await vi.waitFor(() => Vitest.expect(released).toHaveBeenCalledOnce());
    } finally {
      controller.abort();
      vi.useRealTimers();
    }
  },
);
