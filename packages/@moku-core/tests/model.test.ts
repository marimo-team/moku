import { Schema } from "effect";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { Effect, Exit, Scope, Layer } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { FetchHttpClient } from "effect/http";
import { Redacted } from "effect";
import * as Host from "../src/Host.ts";
import { read } from "./state.ts";
import * as Notebook from "../src/Notebook.ts";
import * as Protocol from "../src/Protocol.ts";

const notebook = {
  id: "n",
  project_id: "p",
  name: "demo.py",
  path: "demo.py",
  operations: ["notebook.edit", "runtime.run"],
  updated_at: null,
};
const cell = Schema.decodeUnknownSync(Protocol.Cell)({
  id: "a",
  notebook_id: "n",
  code: "x = 1",
  name: "_",
  config: { column: null, disabled: false, hide_code: false, expand_output: false },
  etag: "cell-1",
  code_fingerprint: "code-1",
  version: 1,
});
const document = Schema.decodeUnknownSync(Protocol.Document)({
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
  const catalogs: TestStream[] = [];
  let editResponse: unknown = { document, cells: {} };
  let holdCommands = false;
  let loseCommands = false;
  let refuseCommands = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/events")) {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const stream: TestStream = {
        request,
        closed: false,
        send: (event, data, id) =>
          controller.enqueue(
            new TextEncoder().encode(
              `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(event === "ready" || event === "reset" ? data : { time: "2026-11-11T12:00:00Z", ...(data as object) })}\n\n`,
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
      if (path.includes("/notebooks/")) streams.push(stream);
      else catalogs.push(stream);
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (loseCommands) throw new TypeError("Connection lost");
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
    if (path.endsWith("/notebooks")) return Response.json(notebook, { status: 201 });
    if (path.endsWith("/open"))
      return Response.json({ url: "http://host.test/notebook" });
    if (request.method === "PATCH") return Response.json(notebook);
    if (/\/notebooks\/[^/]+$/.test(path) && request.method === "DELETE")
      return new Response(null, { status: 204 });
    if (path.endsWith("/edits") || path.endsWith("/save"))
      return Response.json(editResponse);
    if (path.endsWith("/runtime") && request.method === "PUT" && start) return start();
    return Response.json(path.includes("/runs") ? runRecord : runtime, { status: 202 });
  };
  const registry = AtomRegistry.make();
  const scope = await Effect.runPromise(Scope.make());
  type Env = AtomRegistry.AtomRegistry | Scope.Scope;
  const run = <A, E>(effect: Effect.Effect<A, E, Env>, signal?: AbortSignal) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(AtomRegistry.AtomRegistry, registry),
        Effect.provideService(Scope.Scope, scope),
      ),
      { signal },
    );
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  Vitest.onTestFinished(async () => {
    await close();
    registry.dispose();
  });
  const transport = await run(Layer.build(FetchHttpClient.layer));
  const connect = (host = "host-a", options: Pick<Host.Options, "retryWindow"> = {}) =>
    Host.make({
      ...options,
      baseUrl: `http://host.test/${encodeURIComponent(host)}/api/marimo/v1`,
      token: Redacted.make("host-token"),
    }).pipe(
      Effect.provideContext(transport),
      Effect.provideService(FetchHttpClient.Fetch, fetch),
    );
  const attach = (host = "host-a", notebookId = "n") =>
    run(
      connect(host).pipe(
        Effect.flatMap((connection) => connection.notebooks.attach(notebookId)),
      ),
    );
  const stream = async (index = 0) => {
    await vi.waitFor(() => Vitest.expect(streams.length).toBeGreaterThan(index), {
      timeout: 3000,
      interval: 10,
    });
    return streams[index];
  };
  return {
    registry,
    connect,
    catalogs,
    respondEdits: (response: unknown) => {
      editResponse = response;
    },
    run,
    attach,
    stream,
    streams,
    requests,
    close,
    lose: () => {
      loseCommands = true;
    },
    allow: () => {
      loseCommands = false;
      refuseCommands = false;
    },
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
    Vitest.expect(read(f.registry.get(handle.state)).source).toEqual({
      document: null,
      canEdit: false,
    });
    stream.send("ready", {}, "1");
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).source.canEdit).toBe(true),
    );
    stream.send(
      "cell",
      { cell: { ...cell, version: 2, code: "x = 2", etag: "cell-2" } },
      "2",
    );
    await settled();
    Vitest.expect(
      read(f.registry.get(handle.state)).source.document?.cells.get("a")?.code,
    ).toBe("x = 1");
    stream.send(
      "document",
      { document: { ...document, version: 2, etag: "doc-2" } },
      "3",
    );
    await vi.waitFor(() =>
      Vitest.expect(
        read(f.registry.get(handle.state)).source.document?.revision.etag,
      ).toBe("doc-2"),
    );
    Vitest.expect(read(f.registry.get(handle.state)).value.cells.a.code).toBe("x = 2");
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
      Vitest.expect(read(f.registry.get(handle.state)).value.inputs.input?.status).toBe(
        "pending",
      ),
    );
    Vitest.expect(
      read(f.registry.get(handle.state)).value.analysis?.document_etag,
    ).toBe("doc-2");
    Vitest.expect(read(f.registry.get(handle.state)).value.runs["run-1"].id).toBe(
      "run-1",
    );
    Vitest.expect(
      Object.values(read(f.registry.get(handle.state)).value.consoles).map(
        (item) => item.text,
      ),
    ).toEqual(["replacement"]);
    stream.send("execution.removed", { id: "exec" }, "9");
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).value.consoles).toEqual({}),
    );
    Vitest.expect(read(f.registry.get(handle.state)).value.inputs).toEqual({});
    stream.send("reset", {});
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).source.document).toBeNull(),
    );
    Vitest.expect(read(f.registry.get(handle.state)).source.canEdit).toBe(false);
    Vitest.expect(read(f.registry.get(handle.state)).value.runs).toEqual({});
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
      Vitest.expect(read(f.registry.get(handle.state)).source.canEdit).toBe(true),
    );
    first.end();
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).status).toBe("reconnecting"),
    );
    Vitest.expect(read(f.registry.get(handle.state)).source.canEdit).toBe(false);
    Vitest.expect(
      read(f.registry.get(handle.state)).source.document?.revision.etag,
    ).toBe("doc-1");
    const second = await f.stream(1);
    Vitest.expect(second.request.headers.get("last-event-id")).toBe("1");
    second.send("ready", {}, "2");
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).source.canEdit).toBe(true),
    );
    second.send("reset", {}, "2");
    second.send("cell", { cell });
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).source.document).toBeNull(),
    );
    second.end();
    const third = await f.stream(2);
    Vitest.expect(third.request.headers.get("last-event-id")).toBeNull();
    snapshot(third);
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).source.canEdit).toBe(true),
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
      Vitest.expect(read(f.registry.get(second.state)).source.canEdit).toBe(true),
    );
    streamA.send(
      "document",
      { document: { ...document, order: ["missing"], version: 2 } },
      "2",
    );
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(first.state)).status).toBe("error"),
    );
    Vitest.expect(read(f.registry.get(first.state)).source.canEdit).toBe(false);
    Vitest.expect(read(f.registry.get(first.state)).error?.message).toContain(
      "do not match",
    );
    Vitest.expect(streamA.closed).toBe(true);
    Vitest.expect(read(f.registry.get(second.state)).source.canEdit).toBe(true);
    const wrongRegistry = AtomRegistry.make();
    try {
      Vitest.expect(() => wrongRegistry.get(second.state)).toThrow("registry");
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
      handle.edit((tx) => {
        tx.updateCell(cell, { code: "x = 2" });
      }),
    );
    await f.run(handle.save(document, { decisions: { overwrite: "yes" } }));
    await f.run(handle.runtime.start({ decisions: { start: "yes" } }));
    await f.run(handle.runtime.run({ cells: [cell] }));
    await f.run(handle.runtime.cancel({ runId: "run /1" }));
    await f.run(handle.runtime.interrupt());
    await f.run(handle.runtime.stop());
    const commands = f.requests.filter((request) => request.method !== "GET");
    Vitest.expect(
      commands.map((request) => [
        request.method,
        new URL(request.url).pathname.replace(
          "/host%20%2Fa/api/marimo/v1/notebooks/n",
          "",
        ),
        request.headers.get("idempotency-key"),
      ]),
    ).toEqual([
      ["POST", "/edits", Vitest.expect.any(String)],
      ["POST", "/save", Vitest.expect.any(String)],
      ["PUT", "/runtime", Vitest.expect.any(String)],
      ["POST", "/runtime/runs", Vitest.expect.any(String)],
      ["DELETE", "/runtime/runs/run%20%2F1", Vitest.expect.any(String)],
      ["POST", "/runtime/interrupt", Vitest.expect.any(String)],
      ["DELETE", "/runtime", Vitest.expect.any(String)],
    ]);
    Vitest.expect(commands[1].headers.get("if-match")).toBe("doc-1");
    Vitest.expect(await commands[0].json()).toEqual({
      changes: [
        {
          kind: "put_cell",
          base_etag: "cell-1",
          cell: { id: "a", code: "x = 2", name: "_", config: cell.config },
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
    await Vitest.expect(f.run(handle.runtime.interrupt())).rejects.toMatchObject({
      status: 409,
      _tag: "NoRuntimeProblem",
    });
    f.hold();
    const pending = f.run(handle.save(document)).then(
      () => "accepted",
      () => "aborted",
    );
    await vi.waitFor(() =>
      Vitest.expect(f.requests.at(-1)?.headers.get("idempotency-key")).toEqual(
        Vitest.expect.any(String),
      ),
    );
    await f.close();
    Vitest.expect(await pending).toBe("aborted");
    Vitest.expect(f.streams.every((stream) => stream.closed)).toBe(true);
    const count = f.requests.length;
    await Vitest.expect(f.run(handle.save(document))).rejects.toBeDefined();
    Vitest.expect(f.requests).toHaveLength(count);
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
      Vitest.expect(read(f.registry.get(handle.state)).value.ready).toBe(true),
    );
    const result = f.run(handle.ensureRunning).then(
      (value) => value,
      (error: Error) => error.message,
    );
    await vi.waitFor(() => Vitest.expect(start).toHaveBeenCalledOnce());
    stream.send("runtime", { runtime: { ...runtime, status: "starting" } }, "2");
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).value.runtime?.status).toBe(
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
        read(f.registry.get(handle.state)).value.runtime?.status ?? "removed",
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
      outcome === "failed"
        ? "Startup failed"
        : outcome === "removed"
          ? "The runtime stopped during startup."
          : undefined,
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
      Vitest.expect(read(f.registry.get(handle.state)).value.ready).toBe(true),
    );
    let complete = false;
    const result = f.run(handle.ensureRunning).then((value) => {
      complete = true;
      return value;
    });
    await vi.waitFor(() => Vitest.expect(start).toHaveBeenCalledOnce());
    stream.send("runtime", { runtime: { ...runtime, id: "unrelated" } }, "2");
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).value.runtime?.id).toBe(
        "unrelated",
      ),
    );
    await settled();
    Vitest.expect(complete).toBe(false);
    stream.send("runtime", { runtime }, "3");
    Vitest.expect(await result).toBeUndefined();
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
    const result = f.run(handle.ensureRunning);
    await vi.waitFor(() => Vitest.expect(start).toHaveBeenCalledOnce());
    stream.send("runtime", { runtime: { ...runtime, status: "starting" } }, "2");
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).value.runtime?.status).toBe(
        "starting",
      ),
    );
    response.resolve(Response.json(runtime, { status: 202 }));
    Vitest.expect(await result).toBeUndefined();
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
      Vitest.expect(read(f.registry.get(handle.state)).value.runtime?.status).toBe(
        "starting",
      ),
    );
    const result = f.run(handle.ensureRunning);
    await settled();
    stream.send("runtime", { runtime }, "3");
    Vitest.expect(await result).toBeUndefined();
    Vitest.expect(await f.run(handle.ensureRunning)).toBeUndefined();
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
      Vitest.expect(read(f.registry.get(handle.state)).value.ready).toBe(true),
    );

    const controller = new AbortController();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const result = Effect.runPromise(
        handle.ensureRunning.pipe(
          Effect.provideService(AtomRegistry.AtomRegistry, f.registry),
        ),
        { signal: controller.signal },
      ).then(
        () => "succeeded",
        (error: { _tag?: string }) => error._tag ?? "interrupted",
      );
      await vi.waitFor(() => Vitest.expect(start).toHaveBeenCalledOnce());
      if (end === "timeout") await vi.advanceTimersByTimeAsync(60_000);
      else controller.abort();
      Vitest.expect(await result).toBe(
        end === "timeout" ? "TimeoutError" : "interrupted",
      );
      Vitest.expect(stream.closed).toBe(false);
    } finally {
      controller.abort();
      vi.useRealTimers();
    }
  },
);

Vitest.test(
  "supplied clients retain routing, authentication, and notebook identity",
  async () => {
    const f = await fixture();
    const id = "n /%雪";
    const handle = await f.attach("host /a", id);
    const stream = await f.stream();
    Vitest.expect(handle.id).toBe(id);
    Vitest.expect(stream.request.url).toContain(
      `/host%20%2Fa/api/marimo/v1/notebooks/${encodeURIComponent(id)}/events`,
    );
    Vitest.expect(stream.request.headers.get("authorization")).toBe(
      "Bearer host-token",
    );
    stream.send("notebook", { notebook: { ...notebook, id } });
    stream.send("ready", {}, "1");
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).value.ready).toBe(true),
    );
    stream.send("document", { document });
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).error?.message).toBe(
        "Error: Record belongs to another notebook.",
      ),
    );
    Vitest.expect(stream.closed).toBe(true);
  },
);

Vitest.test(
  "cancelling one command leaves the notebook observation alive",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const stream = await f.stream();
    f.hold();
    const caller = new AbortController();
    const pending = f.run(handle.save(document), caller.signal).then(
      () => "accepted",
      () => "aborted",
    );
    await vi.waitFor(() =>
      Vitest.expect(f.requests.at(-1)?.headers.get("idempotency-key")).toEqual(
        Vitest.expect.any(String),
      ),
    );
    caller.abort();
    Vitest.expect(await pending).toBe("aborted");
    Vitest.expect(f.requests.at(-1)?.signal.aborted).toBe(true);
    Vitest.expect(stream.closed).toBe(false);
  },
);

Vitest.test(
  "edits compose patches and generated IDs, and receipts can run before stream confirmation",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    let created: Protocol.CellId | undefined;
    const edit = handle.edit((tx) => {
      tx.updateCell(cell, { code: "x = 2", config: { hide_code: true } });
      tx.updateCell(cell, { config: { disabled: true } });
      created = tx.createCell({ code: "y = 3" });
      tx.updateCell(created, { code: "y = 4" });
      tx.setOrder(document, [created, cell.id]);
    });
    f.respondEdits({
      document: { ...document, etag: "doc-2", version: 2 },
      cells: {
        a: { etag: "cell-2", version: 2, code_fingerprint: "code-2" },
        deleted: null,
      },
    });
    const accepted = await f.run(edit);
    Vitest.expect(created).toMatch(/^[A-Za-z]{4}$/);
    const request = f.requests.find((request) => request.method === "POST")!;
    Vitest.expect(await request.json()).toMatchObject({
      changes: [
        {
          kind: "put_cell",
          base_etag: cell.etag,
          cell: {
            code: "x = 2",
            config: { hide_code: true, disabled: true, expand_output: false },
          },
        },
        { kind: "put_cell", base_etag: null, cell: { id: created, code: "y = 4" } },
        {
          kind: "set_order",
          base_etag: document.order_etag,
          order: [created, cell.id],
        },
      ],
    });
    Vitest.expect(accepted.cells).toEqual([
      { id: "a", notebook_id: "n", etag: "cell-2" },
    ]);
    await f.run(handle.runtime.run({ cells: accepted.cells }));
    Vitest.expect(await f.requests.at(-1)!.json()).toEqual({
      cells: [{ id: "a", etag: "cell-2" }],
    });
    Vitest.expect(AsyncResult.isInitial(f.registry.get(handle.state))).toBe(true);
  },
);

Vitest.test(
  "retries preserve one edit and key while separate edits get separate keys",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const callback = vi.fn((tx: Notebook.Transaction) => {
      tx.createCell({ code: "x = 1" });
    });
    const operation = handle.edit(callback);
    f.lose();
    await Vitest.expect(f.run(operation)).rejects.toBeDefined();
    f.allow();
    await f.run(operation);
    await f.run(operation);
    await f.run(handle.edit(callback));
    const requests = f.requests.filter((request) => request.method === "POST");
    Vitest.expect(callback).toHaveBeenCalledTimes(3);
    Vitest.expect(requests[0].headers.get("idempotency-key")).toBe(
      requests[1].headers.get("idempotency-key"),
    );
    Vitest.expect(requests[2].headers.get("idempotency-key")).not.toBe(
      requests[0].headers.get("idempotency-key"),
    );
    Vitest.expect(await requests[0].json()).toEqual(await requests[1].json());
    const uncertain = handle.edit(callback);
    f.lose();
    await Vitest.expect(f.run(uncertain)).rejects.toBeDefined();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 60_001);
      await Vitest.expect(f.run(uncertain)).rejects.toMatchObject({
        reason: "retry-expired",
      });
      Vitest.expect(
        f.requests.filter((request) => request.method === "POST"),
      ).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  },
);

Vitest.test(
  "invalid transactions send nothing and escaped transactions cannot mutate a submitted edit",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    for (const callback of [
      (tx: Notebook.Transaction) => {
        tx.createCell({ code: "discard" });
        throw new Error("rollback");
      },
      async (tx: Notebook.Transaction) => {
        tx.createCell({ code: "discard" });
        await Promise.resolve();
        throw new Error("late failure");
      },
      (tx: Notebook.Transaction) =>
        tx.updateCell(
          Schema.decodeUnknownSync(Protocol.Cell)({ ...cell, notebook_id: "other" }),
          { code: "wrong notebook" },
        ),
    ])
      await Vitest.expect(f.run(handle.edit(callback))).rejects.toMatchObject({
        reason: "invalid-edit",
      });
    Vitest.expect(f.requests.every((request) => request.method === "GET")).toBe(true);
    let escaped: Notebook.Transaction | undefined;
    await f.run(
      handle.edit((tx) => {
        escaped = tx;
        tx.updateCell(cell, { code: "x = 2" });
      }),
    );
    Vitest.expect(() => escaped?.updateCell(cell, { code: "x = 3" })).toThrow("ended");
  },
);

Vitest.test(
  "unknown events advance the cursor without invalidating known state",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const first = await f.stream();
    snapshot(first);
    first.send("future.record", { arbitrary: true }, "future-2");
    await vi.waitFor(() =>
      Vitest.expect(AsyncResult.isSuccess(f.registry.get(handle.state))).toBe(true),
    );
    await settled();
    first.end();
    const second = await f.stream(1);
    Vitest.expect(second.request.headers.get("last-event-id")).toBe("future-2");
    second.send("ready", {}, "future-3");
    second.send("cell", { cell: { id: "broken" } }, "future-4");
    await vi.waitFor(() =>
      Vitest.expect(AsyncResult.isFailure(f.registry.get(handle.state))).toBe(true),
    );
    Vitest.expect(f.registry.get(handle.state).waiting).toBe(false);
  },
);

Vitest.test(
  "the host publishes a coherent catalog and closes notebooks attached in another scope",
  async () => {
    const f = await fixture();
    const owner = await Effect.runPromise(Scope.make());
    const host = await f.run(
      f.connect().pipe(Effect.provideService(Scope.Scope, owner)),
    );
    const attached = await f.run(host.notebooks.attach("n"));
    const notebookStream = await f.stream();
    await vi.waitFor(() => Vitest.expect(f.catalogs).toHaveLength(1));
    const stream = f.catalogs[0];
    stream.send("host", { host: { operations: ["notebook.create"] } });
    stream.send("project", {
      project: {
        id: "p",
        name: "Project",
        root: null,
        status: "indexed",
        message: null,
        operations: ["notebook.create"],
      },
    });
    stream.send("notebook", { notebook });
    stream.send("runtime", { runtime });
    await settled();
    Vitest.expect(AsyncResult.isInitial(f.registry.get(host.state))).toBe(true);
    stream.send("ready", {}, "catalog-1");
    await vi.waitFor(() =>
      Vitest.expect(AsyncResult.isSuccess(f.registry.get(host.state))).toBe(true),
    );
    const state = AsyncResult.getOrThrow(f.registry.get(host.state));
    Vitest.expect(Object.keys(state.projects)).toEqual(["p"]);
    Vitest.expect(Object.keys(state.notebooks)).toEqual(["n"]);
    Vitest.expect(Object.keys(state.runtimes)).toEqual(["rt"]);
    stream.send("notebook.removed", { id: "n" }, "catalog-2");
    await vi.waitFor(() =>
      Vitest.expect(
        AsyncResult.getOrThrow(f.registry.get(host.state)).runtimes,
      ).toEqual({}),
    );
    await Effect.runPromise(Scope.close(owner, Exit.void));
    Vitest.expect(notebookStream.closed).toBe(true);
    Vitest.expect(stream.closed).toBe(true);
    await Vitest.expect(f.run(host.notebooks.attach("n"))).rejects.toMatchObject({
      reason: "closed",
    });
    await Vitest.expect(f.run(attached.runtime.interrupt())).rejects.toMatchObject({
      reason: "closed",
    });
  },
);

Vitest.test(
  "host notebook operations route and authenticate through the injected transport",
  async () => {
    const f = await fixture();
    const host = await f.run(f.connect("host /a"));
    await f.run(
      host.notebooks.create(
        Schema.decodeUnknownSync(Protocol.CreateNotebookRequest)({
          project_id: "p",
          name: "Untitled",
        }),
      ),
    );
    await f.run(host.notebooks.update("n /1", { name: "Renamed" }));
    Vitest.expect(await f.run(host.notebooks.open("n /1"))).toEqual({
      url: "http://host.test/notebook",
    });
    await f.run(host.notebooks.delete("n /1"));
    const commands = f.requests.filter((request) => request.method !== "GET");
    Vitest.expect(
      commands.map((request) => [request.method, new URL(request.url).pathname]),
    ).toEqual([
      ["POST", "/host%20%2Fa/api/marimo/v1/notebooks"],
      ["PATCH", "/host%20%2Fa/api/marimo/v1/notebooks/n%20%2F1"],
      ["POST", "/host%20%2Fa/api/marimo/v1/notebooks/n%20%2F1/open"],
      ["DELETE", "/host%20%2Fa/api/marimo/v1/notebooks/n%20%2F1"],
    ]);
    for (const request of commands)
      Vitest.expect(request.headers.get("authorization")).toBe("Bearer host-token");
    Vitest.expect(
      new Set(commands.map((request) => request.headers.get("idempotency-key"))).size,
    ).toBe(4);
  },
);

Vitest.test(
  "ensureRunning waits for reconnection before trusting a previously running runtime",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const first = await f.stream();
    snapshot(first);
    first.send("runtime", { runtime }, "2");
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).value.runtime?.status).toBe(
        "running",
      ),
    );
    first.end();
    const second = await f.stream(1);
    let completed = false;
    const result = f.run(handle.ensureRunning).then(() => {
      completed = true;
    });
    await settled();
    Vitest.expect(completed).toBe(false);
    second.send("ready", {}, "3");
    await result;
    Vitest.expect(
      f.requests.filter((request) => request.method === "PUT"),
    ).toHaveLength(0);
  },
);

Vitest.test(
  "attachments share a notebook and its registry until the last lease closes",
  async () => {
    const f = await fixture();
    const host = await f.run(f.connect());
    const a = await Effect.runPromise(Scope.make());
    const b = await Effect.runPromise(Scope.make());
    const attach = (scope: Scope.Scope) =>
      Effect.runPromise(
        host.notebooks.attach("n").pipe(Effect.provideService(Scope.Scope, scope)),
      );
    const [first, second] = await Promise.all([attach(a), attach(b)]);
    Vitest.expect(first).toBe(second);
    const stream = await f.stream();
    snapshot(stream);
    await vi.waitFor(() =>
      Vitest.expect(AsyncResult.isSuccess(f.registry.get(first.state))).toBe(true),
    );
    Vitest.expect(f.streams).toHaveLength(1);
    await Effect.runPromise(Scope.close(a, Exit.void));
    Vitest.expect(stream.closed).toBe(false);
    await Effect.runPromise(Scope.close(b, Exit.void));
    Vitest.expect(stream.closed).toBe(true);
    const replacement = await f.run(host.notebooks.attach("n"));
    Vitest.expect(replacement).not.toBe(first);
    await f.stream(1);
  },
);

Vitest.test(
  "analysis is published only with its matching coherent document",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const stream = await f.stream();
    snapshot(stream);
    const analysis = {
      notebook_id: "n",
      document_etag: "doc-1",
      cells: { a: { defs: ["x"], refs: [], errors: [] } },
    };
    stream.send("analysis", { analysis }, "2");
    await vi.waitFor(() =>
      Vitest.expect(
        AsyncResult.getOrThrow(f.registry.get(handle.state)).analysis,
      ).toEqual(analysis),
    );
    stream.send(
      "cell",
      { cell: { ...cell, code: "x = 2", etag: "cell-2", version: 2 } },
      "3",
    );
    stream.send(
      "document",
      { document: { ...document, etag: "doc-2", version: 2 } },
      "4",
    );
    await vi.waitFor(() =>
      Vitest.expect(
        AsyncResult.getOrThrow(f.registry.get(handle.state)).document?.etag,
      ).toBe("doc-2"),
    );
    Vitest.expect(
      AsyncResult.getOrThrow(f.registry.get(handle.state)).analysis,
    ).toBeNull();
    stream.send("analysis", { analysis: { ...analysis, document_etag: "doc-2" } }, "5");
    await vi.waitFor(() =>
      Vitest.expect(
        AsyncResult.getOrThrow(f.registry.get(handle.state)).analysis?.document_etag,
      ).toBe("doc-2"),
    );
  },
);

Vitest.test(
  "run rejects cells from another notebook even when their IDs and etags match",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const other = Schema.decodeUnknownSync(Protocol.Cell)({
      ...cell,
      notebook_id: "other",
    });
    await Vitest.expect(
      f.run(handle.runtime.run({ cells: [other] })),
    ).rejects.toMatchObject({ reason: "invalid-edit" });
    Vitest.expect(f.requests.every((request) => request.method === "GET")).toBe(true);
  },
);

Vitest.test(
  "cancelled creations leave no order entries and cannot remain placement anchors",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    await Vitest.expect(
      f.run(
        handle.edit((tx) => {
          const anchor = tx.createCell({ code: "x = 1" });
          tx.createCell({ code: "y = 2" }, { after: anchor });
          tx.deleteCell(anchor);
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-edit" });
    Vitest.expect(f.requests.every((request) => request.method === "GET")).toBe(true);
    await f.run(
      handle.edit((tx) => {
        const cancelled = tx.createCell({ code: "discard" });
        tx.setOrder(document, [cancelled, cell.id]);
        tx.deleteCell(cancelled);
      }),
    );
    Vitest.expect(await f.requests.at(-1)!.json()).toEqual({
      changes: [
        { kind: "set_order", base_etag: document.order_etag, order: [cell.id] },
      ],
    });
  },
);

Vitest.test(
  "startup accepts a running response after reconnecting without another event",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const first = await f.stream();
    snapshot(first);
    first.send("runtime", { runtime }, "2");
    await vi.waitFor(() =>
      Vitest.expect(read(f.registry.get(handle.state)).value.runtime?.status).toBe(
        "running",
      ),
    );
    first.end();
    const second = await f.stream(1);
    const result = Effect.runPromiseExit(handle.ensureRunning);
    second.send("runtime.removed", { id: runtime.id }, "3");
    second.send("ready", {}, "4");
    Vitest.expect((await result)._tag).toBe("Success");
    Vitest.expect(
      f.requests.filter((request) => request.method === "PUT"),
    ).toHaveLength(1);
  },
);

Vitest.test(
  "repeating and concurrently executing a successful mutation submits new work",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const run = handle.runtime.run({ cells: [cell] });
    await f.run(Effect.all([run, run], { concurrency: "unbounded" }));
    await f.run(run.pipe(Effect.repeat({ times: 1 })));
    const requests = f.requests.filter((request) => request.method === "POST");
    Vitest.expect(requests).toHaveLength(4);
    Vitest.expect(
      new Set(requests.map((request) => request.headers.get("idempotency-key"))).size,
    ).toBe(4);
  },
);

Vitest.test(
  "definitive rejections retire request keys and a zero retry window prevents uncertain replay",
  async () => {
    const f = await fixture();
    const handle = await f.attach();
    const operation = handle.runtime.interrupt();
    f.refuse();
    await Vitest.expect(f.run(operation)).rejects.toMatchObject({
      _tag: "NoRuntimeProblem",
    });
    f.allow();
    await f.run(operation);
    const first = f.requests.filter((request) => request.method === "POST");
    Vitest.expect(first[0].headers.get("idempotency-key")).not.toBe(
      first[1].headers.get("idempotency-key"),
    );
    const host = await f.run(f.connect("short-window", { retryWindow: 0 }));
    const other = await f.run(host.notebooks.attach("n"));
    const uncertain = other.runtime.interrupt();
    f.lose();
    await Vitest.expect(f.run(uncertain)).rejects.toMatchObject({
      _tag: "HttpClientError",
    });
    const count = f.requests.length;
    await Vitest.expect(f.run(uncertain)).rejects.toMatchObject({
      reason: "retry-expired",
    });
    Vitest.expect(f.requests).toHaveLength(count);
  },
);
