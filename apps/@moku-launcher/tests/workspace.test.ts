// @vitest-environment happy-dom
import * as Http from "./http.ts";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { Effect, Exit, Scope } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Workspace from "../src/app/Workspace.ts";
import * as Document from "@moku/editor/Document";

const notebook = {
  id: "n",
  project_id: "p",
  name: "demo.py",
  path: "demo.py",
  operations: [],
  updated_at: null,
};

async function fixture(launchKey?: string) {
  const requests: Request[] = [];
  const streams: {
    request: Request;
    closed: boolean;
    send: (event: string, data: Record<string, unknown>, id?: string) => void;
  }[] = [];
  const connections = [
    { id: "local", name: "local", url: "http://host/api/marimo/v1", source: "local" },
  ];
  let respond: ((request: Request) => Promise<Response | undefined>) | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    requests.push(request);
    const response = await respond?.(request);
    if (response) return response;
    const path = new URL(request.url).pathname;
    if (path === "/api/session") return Response.json({ authenticated: true });
    if (path === "/api/hosts") {
      if (request.method === "GET") return Response.json(connections);
      const input = await request.json();
      const connection = {
        id: "manual",
        name: "manual",
        url: input.url,
        source: "manual",
      };
      connections.push(connection);
      return Response.json(connection, { status: 201 });
    }
    if (path.endsWith("/events")) {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const stream = {
        request,
        closed: false,
        send: (event: string, data: Record<string, unknown>, id = "1") =>
          controller.enqueue(
            new TextEncoder().encode(
              `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(event === "ready" || event === "reset" ? data : { time: "2026-11-11T12:00:00Z", ...data })}\n\n`,
            ),
          ),
      };
      const body = new ReadableStream<Uint8Array>({
        start(value) {
          controller = value;
        },
        cancel() {
          stream.closed = true;
        },
      });
      request.signal.addEventListener(
        "abort",
        () => {
          if (!stream.closed) {
            stream.closed = true;
            controller.close();
          }
        },
        { once: true },
      );
      streams.push(stream);
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    }
    if (path.endsWith("/open")) return Response.json({ url: "http://host/notebook" });
    return Response.json({ success: true });
  };
  const registry = AtomRegistry.make();
  const scope = Effect.runSync(Scope.make());
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
  return {
    run,
    workspace: await run(
      Workspace.make({ launchKey }).pipe(Effect.provide(Http.layer(fetch))),
    ),
    registry,
    requests,
    streams,
    close,
    respond: (handler: typeof respond) => {
      respond = handler;
    },
    stream: async () => {
      await vi.waitFor(() => Vitest.expect(streams).toHaveLength(1));
      return streams[0];
    },
  };
}

Vitest.test(
  "correcting credentials restarts shared observations without discarding editor drafts",
  async () => {
    const f = await fixture();
    const { workspace } = f;
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(workspace.state).connections).toHaveLength(1),
    );
    const url = "http://manual/api/marimo/v1";
    await f.run(workspace.connect({ url, token: "expired" }));
    const target = { connectionId: "manual", notebookId: "n" };
    const attached = await f.run(workspace.attach(target));
    const editing = await f.run(Document.make(attached));
    const catalog = workspace.catalog("manual");
    Vitest.onTestFinished(f.registry.mount(catalog));
    const snapshot = (stream: (typeof f.streams)[number]) => {
      stream.send("notebook", {
        notebook: { ...notebook, operations: ["notebook.edit"] },
      });
      if (stream.request.url.includes("/notebooks/")) {
        stream.send("cell", {
          cell: {
            id: "a",
            notebook_id: "n",
            code: "x = 1",
            name: "_",
            config: {
              column: null,
              disabled: false,
              hide_code: false,
              expand_output: false,
            },
            etag: "cell-1",
            code_fingerprint: "code-1",
            version: 1,
          },
        });
        stream.send("document", {
          document: {
            notebook_id: "n",
            order: ["a"],
            app_config: {},
            etag: "doc-1",
            saved_etag: "doc-1",
            order_etag: "order-1",
            app_config_etag: "config-1",
            version: 1,
          },
        });
      }
      stream.send("ready", {}, "cursor-1");
    };
    await vi.waitFor(() => Vitest.expect(f.streams).toHaveLength(2));
    f.streams.forEach(snapshot);
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(editing.state).canEdit).toBe(true),
    );
    editing.edit((tx) => tx.setCode("a", "unsent = 2"));
    f.respond(async (request) =>
      new URL(request.url).pathname.endsWith("/events")
        ? Response.json(
            {
              type: "urn:marimo:problem:unauthorized",
              title: "Unauthorized",
              status: 401,
            },
            { status: 401, headers: { "Content-Type": "application/problem+json" } },
          )
        : undefined,
    );
    await f.run(workspace.connect({ url, token: "expired" }));
    await vi.waitFor(() => {
      for (const result of [f.registry.get(catalog), f.registry.get(attached.state)]) {
        Vitest.expect(result).toMatchObject({
          _tag: "Failure",
          waiting: false,
        });
      }
    });
    Vitest.expect(f.streams.every((stream) => stream.closed)).toBe(true);
    Vitest.expect(f.registry.get(editing.state).document?.cells.get("a")?.code).toBe(
      "unsent = 2",
    );

    f.respond(undefined);
    await f.run(workspace.connect({ url, token: "corrected" }));
    Vitest.expect((await f.run(workspace.attach(target))).state).toBe(attached.state);
    Vitest.expect(workspace.catalog("manual")).toBe(catalog);
    await vi.waitFor(() => Vitest.expect(f.streams).toHaveLength(4));
    for (const stream of f.streams.slice(2)) {
      Vitest.expect(stream.request.headers.has("last-event-id")).toBe(false);
      snapshot(stream);
    }
    await vi.waitFor(() => {
      Vitest.expect(AsyncResult.isSuccess(f.registry.get(catalog))).toBe(true);
      Vitest.expect(f.registry.get(editing.state).canEdit).toBe(true);
    });
    Vitest.expect(f.registry.get(editing.state)).toMatchObject({ dirty: true });
    Vitest.expect(f.registry.get(editing.state).document?.cells.get("a")?.code).toBe(
      "unsent = 2",
    );
    await f.close();
    Vitest.expect(f.streams.every((stream) => stream.closed)).toBe(true);
    await Vitest.expect(f.run(workspace.open(target))).rejects.toBeDefined();
    Vitest.expect(f.streams).toHaveLength(4);
  },
);

Vitest.test(
  "workspace authenticates, shares catalog atoms, and refreshes after manual connections",
  async () => {
    const f = await fixture("launch-key");
    const { workspace } = f;
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
      Vitest.expect(AsyncResult.isSuccess(f.registry.get(catalog))).toBe(true),
    );
    Vitest.expect(
      AsyncResult.getOrThrow(f.registry.get(catalog)).notebooks.n.name,
    ).toBe("demo.py");
    stream.send("reset", {});
    await vi.waitFor(() =>
      Vitest.expect(AsyncResult.isInitial(f.registry.get(catalog))).toBe(true),
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
    Vitest.expect(f.registry.get(workspace.state).status).toEqual(
      Workspace.Status.Idle(),
    );
    unmount();
    await vi.waitFor(() => Vitest.expect(stream.closed).toBe(true));
  },
);

Vitest.test(
  "proxy requests preserve policy, routing, and structured failures",
  async () => {
    const f = await fixture();
    const { workspace } = f;
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(workspace.state).connections).toHaveLength(1),
    );
    await f.run(
      workspace.open({
        connectionId: "host /a",
        notebookId: "n /b",
      }),
    );
    const open = f.requests.at(-1)!;
    Vitest.expect(new URL(open.url).pathname).toBe(
      "/api/hosts/host%20%2Fa/notebooks/n%20%2Fb/open",
    );
    Vitest.expect(open.headers.get("idempotency-key")).toEqual(
      Vitest.expect.any(String),
    );
    for (const request of f.requests) {
      Vitest.expect(request.credentials).toBe("same-origin");
      Vitest.expect(request.redirect).toBe("error");
    }
    const problem = { error: "Host unavailable", code: "host-unavailable" };
    f.respond(async () => Response.json(problem, { status: 503 }));
    await Vitest.expect(f.run(workspace.refresh)).rejects.toMatchObject({
      message: problem.error,
      code: problem.code,
      status: 503,
      problem,
    });
    Vitest.expect(f.registry.get(workspace.state).status).toMatchObject({
      _tag: "Failed",
      error: { message: problem.error },
    });
    f.respond(async () => new Response("Bad gateway", { status: 502 }));
    await Vitest.expect(f.run(workspace.refresh)).rejects.toMatchObject({
      status: 502,
    });
    f.respond(async () => Response.json({ wrong: "shape" }));
    await Vitest.expect(f.run(workspace.refresh)).rejects.toMatchObject({
      _tag: "RequestError",
    });
  },
);

Vitest.test.each(["caller", "workspace"] as const)(
  "requests abort with their %s",
  async (owner) => {
    const f = await fixture();
    const { workspace } = f;
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(workspace.state).connections).toHaveLength(1),
    );
    f.respond(
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            { once: true },
          );
        }),
    );
    const caller = new AbortController();
    const pending = f
      .run(
        workspace.connect({ url: "http://manual/api/marimo/v1", token: "token" }),
        caller.signal,
      )
      .then(
        () => "accepted",
        () => "aborted",
      );
    await vi.waitFor(() => Vitest.expect(f.requests.at(-1)?.method).toBe("POST"));
    const request = f.requests.at(-1)!;
    if (owner === "caller") caller.abort();
    else await f.close();
    Vitest.expect(await pending).toBe("aborted");
    Vitest.expect(request.signal.aborted).toBe(true);
    if (owner === "workspace") {
      const count = f.requests.length;
      await Vitest.expect(f.run(workspace.refresh)).rejects.toBeDefined();
      Vitest.expect(f.requests).toHaveLength(count);
    }
  },
);

Vitest.test(
  "refresh leaves pending state on cancellation and clears failure on recovery",
  async () => {
    const f = await fixture();
    const { workspace } = f;
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(workspace.state).connections).toHaveLength(1),
    );
    f.respond(async () => Response.json({ error: "Offline" }, { status: 503 }));
    await Vitest.expect(f.run(workspace.refresh)).rejects.toBeDefined();
    Vitest.expect(f.registry.get(workspace.state).status).toMatchObject({
      _tag: "Failed",
      error: { message: "Offline" },
    });
    f.respond(
      (request) =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            { once: true },
          );
        }),
    );
    const caller = new AbortController();
    const request = f.run(workspace.refresh, caller.signal).then(
      () => "accepted",
      () => "aborted",
    );
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(workspace.state).status).toEqual(
        Workspace.Status.Pending(),
      ),
    );
    caller.abort();
    Vitest.expect(await request).toBe("aborted");
    Vitest.expect(f.registry.get(workspace.state).status).toEqual(
      Workspace.Status.Idle(),
    );
    f.respond(async () => Response.json({ error: "Offline" }, { status: 503 }));
    await Vitest.expect(f.run(workspace.refresh)).rejects.toBeDefined();
    f.respond(undefined);
    await f.run(workspace.refresh);
    Vitest.expect(f.registry.get(workspace.state).status).toEqual(
      Workspace.Status.Idle(),
    );
  },
);
