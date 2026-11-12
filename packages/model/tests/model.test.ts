import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { Effect, Exit, Layer, Scope } from "effect";
import { AtomRegistry } from "effect/reactivity";
import * as Model from "../src/index.ts";
import * as Notebook from "../src/Notebook.ts";
import * as Workspace from "../src/Workspace.ts";
import * as Protocol from "../src/Protocol.ts";

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

async function fixture() {
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
    return Response.json(path.includes("/runs") ? runRecord : runtime, { status: 202 });
  };
  const registry = AtomRegistry.make();
  const scope = await Effect.runPromise(Scope.make());
  const layer = Model.layer("http://momo.test", { fetch });
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
  onTestFinished(async () => {
    await close();
    registry.dispose();
  });
  const attach = (connectionId = "host-a") =>
    run(Notebook.make({ connectionId, notebookId: "n" }));
  const stream = async (index = 0) => {
    await vi.waitFor(() => expect(streams.length).toBeGreaterThan(index), {
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

test("workspace authenticates, shares catalog atoms, and refreshes after manual connections", async () => {
  const f = await fixture();
  const workspace = await f.run(Workspace.make({ launchKey: "launch-key" }));
  await vi.waitFor(() => expect(f.registry.get(workspace.connections)).toHaveLength(1));
  expect(f.requests[0].headers.get("authorization")).toBe("Bearer launch-key");
  const catalog = workspace.catalog("local");
  expect(workspace.catalog("local")).toBe(catalog);
  expect(f.streams).toHaveLength(0);
  const unmount = f.registry.mount(catalog);
  const stream = await f.stream();
  stream.send("notebook", { notebook });
  stream.send("ready", {}, "1");
  await vi.waitFor(() => expect(f.registry.get(catalog).value.ready).toBe(true));
  expect(f.registry.get(catalog).value.notebooks.n.name).toBe("demo.py");
  stream.send("reset", {});
  await vi.waitFor(() => expect(f.registry.get(catalog).value.notebooks).toEqual({}));
  await f.run(
    workspace.connect({ url: "http://manual/api/marimo/v1", token: "secret" }),
  );
  expect(f.registry.get(workspace.connections)).toHaveLength(2);
  expect(JSON.stringify(f.registry.get(workspace.connections))).not.toContain("secret");
  await f.run(workspace.refresh);
  expect(f.registry.get(workspace.connections)).toHaveLength(2);
  expect(f.registry.get(workspace.status)).toEqual({ pending: false, error: null });
  unmount();
  await vi.waitFor(() => expect(stream.closed).toBe(true));
});

test("only coherent document revisions become editable; output replacement, removal, and reset remain intact", async () => {
  const f = await fixture();
  const handle = await f.attach();
  const stream = await f.stream();
  stream.send("notebook", { notebook });
  stream.send("cell", { cell });
  stream.send("document", { document });
  await settled();
  expect(f.registry.get(handle.source)).toEqual({ document: null, canEdit: false });
  stream.send("ready", {}, "1");
  await vi.waitFor(() => expect(f.registry.get(handle.source).canEdit).toBe(true));
  stream.send(
    "cell",
    { cell: { ...cell, version: 2, code: "x = 2", etag: "cell-2" } },
    "2",
  );
  await settled();
  expect(f.registry.get(handle.source).document?.cells.get("a")?.code).toBe("x = 1");
  stream.send(
    "document",
    { document: { ...document, version: 2, etag: "doc-2" } },
    "3",
  );
  await vi.waitFor(() =>
    expect(f.registry.get(handle.source).document?.revision.etag).toBe("doc-2"),
  );
  expect(f.registry.get(handle.state).value.cells.a.code).toBe("x = 2");
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
    expect(f.registry.get(handle.state).value.inputs.input?.status).toBe("pending"),
  );
  expect(f.registry.get(handle.state).value.analysis?.document_etag).toBe("doc-2");
  expect(f.registry.get(handle.state).value.runs["run-1"].id).toBe("run-1");
  expect(
    Object.values(f.registry.get(handle.state).value.consoles).map((item) => item.text),
  ).toEqual(["replacement"]);
  stream.send("execution.removed", { id: "exec" }, "9");
  await vi.waitFor(() =>
    expect(f.registry.get(handle.state).value.consoles).toEqual({}),
  );
  expect(f.registry.get(handle.state).value.inputs).toEqual({});
  stream.send("reset", {});
  await vi.waitFor(() => expect(f.registry.get(handle.source).document).toBeNull());
  expect(f.registry.get(handle.source).canEdit).toBe(false);
  expect(f.registry.get(handle.state).value.runs).toEqual({});
});

test("replay retains the confirmed revision but disables editing until ready; reset discards its cursor", async () => {
  const f = await fixture();
  const handle = await f.attach();
  const first = await f.stream();
  snapshot(first);
  await vi.waitFor(() => expect(f.registry.get(handle.source).canEdit).toBe(true));
  first.end();
  await vi.waitFor(() =>
    expect(f.registry.get(handle.state).status).toBe("reconnecting"),
  );
  expect(f.registry.get(handle.source).canEdit).toBe(false);
  expect(f.registry.get(handle.source).document?.revision.etag).toBe("doc-1");
  const second = await f.stream(1);
  expect(second.request.headers.get("last-event-id")).toBe("1");
  second.send("ready", {}, "2");
  await vi.waitFor(() => expect(f.registry.get(handle.source).canEdit).toBe(true));
  second.send("reset", {}, "2");
  second.send("cell", { cell });
  await vi.waitFor(() => expect(f.registry.get(handle.source).document).toBeNull());
  second.end();
  const third = await f.stream(2);
  expect(third.request.headers.get("last-event-id")).toBeNull();
  snapshot(third);
  await vi.waitFor(() => expect(f.registry.get(handle.source).canEdit).toBe(true));
}, 10000);

test("attachments isolate identical notebook IDs and stop on incoherent document events", async () => {
  const f = await fixture();
  const first = await f.attach("host-a");
  const second = await f.attach("host-b");
  const streamA = await f.stream(0);
  const streamB = await f.stream(1);
  snapshot(streamA);
  snapshot(streamB);
  await vi.waitFor(() => expect(f.registry.get(second.source).canEdit).toBe(true));
  streamA.send(
    "document",
    { document: { ...document, order: ["missing"], version: 2 } },
    "2",
  );
  await vi.waitFor(() => expect(f.registry.get(first.state).status).toBe("error"));
  expect(f.registry.get(first.source).canEdit).toBe(false);
  expect(f.registry.get(first.state).error?.message).toContain("do not match");
  expect(streamA.closed).toBe(true);
  expect(f.registry.get(second.source).canEdit).toBe(true);
  const wrongRegistry = AtomRegistry.make();
  try {
    expect(() => wrongRegistry.get(second.state)).toThrow("AtomRegistry");
  } finally {
    wrongRegistry.dispose();
  }
  await f.close();
  expect(streamB.closed).toBe(true);
});

test("bound commands preserve preconditions, distinguish cancel from interrupt, and abort on scope close", async () => {
  const f = await fixture();
  const handle = await f.attach("host /a");
  await f.stream();
  await f.run(
    handle.edit(
      {
        changes: [
          { kind: "put_cell", base_etag: "cell-1", cell: { id: "a", code: "x = 2" } },
        ],
      },
      "edit-key",
    ),
  );
  await f.run(handle.save("doc-1", "save-key"));
  await f.run(handle.start("start-key"));
  await f.run(handle.run({ cells: [{ id: "a", etag: "cell-1" }] }, "run-key"));
  await f.run(handle.cancel("run /1", "cancel-key"));
  await f.run(handle.interrupt("interrupt-key"));
  await f.run(handle.stop("stop-key"));
  const commands = f.requests.filter((request) => request.method !== "GET");
  expect(
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
  expect(commands[1].headers.get("if-match")).toBe("doc-1");
  expect(await commands[3].json()).toEqual({ cells: [{ id: "a", etag: "cell-1" }] });
  f.refuse();
  await expect(f.run(handle.interrupt("refused"))).rejects.toMatchObject({
    status: 409,
    problem: { type: "urn:marimo:problem:no-runtime" },
  });
  f.hold();
  const pending = f.run(handle.save("doc-1", "held")).then(
    () => "accepted",
    () => "aborted",
  );
  await vi.waitFor(() =>
    expect(f.requests.at(-1)?.headers.get("idempotency-key")).toBe("held"),
  );
  await f.close();
  expect(await pending).toBe("aborted");
  expect(f.streams.every((stream) => stream.closed)).toBe(true);
});
