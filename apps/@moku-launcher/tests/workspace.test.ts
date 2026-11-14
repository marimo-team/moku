import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { Effect, Exit, Layer, Scope } from "effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Proxy from "../src/app/Proxy.ts";
import * as Workspace from "../src/app/Workspace.ts";

const notebook = {
  id: "n",
  project_id: "p",
  name: "demo.py",
  path: "demo.py",
  operations: [],
  updated_at: null,
};

async function fixture() {
  const requests: Request[] = [];
  const streams: {
    closed: boolean;
    send: (event: string, data: unknown, id?: string) => void;
  }[] = [];
  const connections = [
    { id: "local", name: "local", url: "http://host/api/marimo/v1", source: "local" },
  ];
  let respond: ((request: Request) => Promise<Response>) | undefined;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    requests.push(request);
    if (respond) return respond(request);
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
        closed: false,
        send: (event: string, data: unknown, id = "1") =>
          controller.enqueue(
            new TextEncoder().encode(
              `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
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
    return Response.json({ success: true });
  };
  const registry = AtomRegistry.make();
  const scope = Effect.runSync(Scope.make());
  const proxy = Proxy.make("http://moku.test", { fetch });
  type Env = Layer.Success<typeof proxy.http> | AtomRegistry.AtomRegistry | Scope.Scope;
  const run = <A, E>(effect: Effect.Effect<A, E, Env>, signal?: AbortSignal) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(proxy.http),
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
    proxy,
    run,
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
  "workspace authenticates, shares catalog atoms, and refreshes after manual connections",
  async () => {
    const f = await fixture();
    const workspace = await f.run(Workspace.make(f.proxy, { launchKey: "launch-key" }));
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
  "proxy requests preserve policy, routing, and structured failures",
  async () => {
    const f = await fixture();
    const workspace = await f.run(Workspace.make(f.proxy));
    await vi.waitFor(() =>
      Vitest.expect(f.registry.get(workspace.state).connections).toHaveLength(1),
    );
    await f.run(
      workspace.open({
        connectionId: "host /a",
        notebookId: "n /b",
        requestId: "open-key",
      }),
    );
    const open = f.requests.at(-1)!;
    Vitest.expect(new URL(open.url).pathname).toBe(
      "/api/hosts/host%20%2Fa/notebooks/n%20%2Fb/open",
    );
    Vitest.expect(open.headers.get("idempotency-key")).toBe("open-key");
    await f.run(
      workspace.authorizeInteractions({
        connectionId: "host /a",
        token: "native-token",
      }),
    );
    Vitest.expect(await f.requests.at(-1)!.json()).toEqual({ token: "native-token" });
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
    Vitest.expect(f.registry.get(workspace.state).status.pending).toBe(false);
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
    const workspace = await f.run(Workspace.make(f.proxy));
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
        workspace.authorizeInteractions({ connectionId: "local", token: "token" }),
        caller.signal,
      )
      .then(
        () => "accepted",
        () => "aborted",
      );
    await vi.waitFor(() =>
      Vitest.expect(f.requests.at(-1)?.url).toContain("/marimo/auth"),
    );
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
