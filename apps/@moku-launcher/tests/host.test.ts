import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { Effect, Exit, Scope } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { Plugin } from "@moku/plugin";
import * as Host from "../src/app/Host.ts";
import { makeRuntime } from "../src/app/runtime.ts";

const view = { id: "main", title: "Main", render: () => null };

async function host(plugins: readonly Plugin.Plugin[]) {
  const registry = AtomRegistry.make();
  const scope = await Effect.runPromise(Scope.make());
  const instance = await Effect.runPromise(
    Host.make(plugins).pipe(
      Effect.provideService(AtomRegistry.AtomRegistry, registry),
      Effect.provideService(Scope.Scope, scope),
    ),
  );
  Vitest.expect(Atom.isWritable(instance.state)).toBe(false);
  const unmount = registry.mount(instance.state);
  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));
  Vitest.onTestFinished(async () => {
    await close();
    unmount();
    registry.dispose();
  });
  return { state: () => registry.get(instance.state), close };
}

Vitest.test(
  "registrations are namespaced and plugin finalizers run when the host closes",
  async () => {
    let finalized = 0;
    const f = await host([
      Plugin.define({
        id: "dag",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.view.add(view);
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                finalized++;
              }),
            );
          }),
      }),
      Plugin.define({ id: "editor", effect: (ctx) => ctx.view.add(view) }),
    ]);
    Vitest.expect(f.state().views.map((view) => view.key)).toEqual([
      "dag/main",
      "editor/main",
    ]);
    Vitest.expect(finalized).toBe(0);
    await f.close();
    Vitest.expect(f.state().views).toEqual([]);
    Vitest.expect(finalized).toBe(1);
    await f.close();
    Vitest.expect(finalized).toBe(1);
  },
);

Vitest.test(
  "failed activation rolls back registrations and resources while other plugins load",
  async () => {
    let released = false;
    const f = await host([
      Plugin.define({
        id: "broken",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.acquireRelease(Effect.void, () =>
              Effect.sync(() => {
                released = true;
              }),
            );
            yield* ctx.view.add(view);
            yield* Effect.fail(new Error("setup failed"));
          }),
      }),
      Plugin.define({ id: "healthy", effect: (ctx) => ctx.view.add(view) }),
    ]);
    Vitest.expect(f.state().views.map((view) => view.key)).toEqual(["healthy/main"]);
    Vitest.expect(f.state().failures[0].pluginId).toBe("broken");
    Vitest.expect(f.state().failures[0].message).toContain("setup failed");
    Vitest.expect(released).toBe(true);
  },
);

Vitest.test(
  "duplicate IDs cannot replace an existing plugin or leave partially registered views",
  async () => {
    let duplicateRan = false;
    const f = await host([
      Plugin.define({ id: "dag", effect: (ctx) => ctx.view.add(view) }),
      Plugin.define({
        id: "dag",
        effect: () =>
          Effect.sync(() => {
            duplicateRan = true;
          }),
      }),
      Plugin.define({
        id: "duplicate-view",
        effect: (ctx) =>
          Effect.gen(function* () {
            yield* ctx.view.add(view);
            yield* ctx.view.add(view);
          }),
      }),
    ]);
    Vitest.expect(duplicateRan).toBe(false);
    Vitest.expect(f.state().views.map((view) => view.key)).toEqual(["dag/main"]);
    Vitest.expect(f.state().failures.map((failure) => failure.pluginId)).toEqual([
      "dag",
      "duplicate-view",
    ]);
  },
);

Vitest.test(
  "view consumers share one attachment per target and release it after the last closes",
  async () => {
    const requests: { url: string; closed: boolean }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const entry = { url: request.url, closed: false };
      requests.push(entry);
      return new Response(
        new ReadableStream({
          start(controller) {
            const notebook = {
              id: "n",
              project_id: "p",
              name: "example.py",
              path: "example.py",
              operations: [],
              updated_at: null,
            };
            controller.enqueue(
              new TextEncoder().encode(
                `event: notebook\ndata: ${JSON.stringify({ notebook })}\n\nevent: ready\nid: 1\ndata: {}\n\n`,
              ),
            );
            request.signal.addEventListener(
              "abort",
              () => {
                entry.closed = true;
                controller.close();
              },
              { once: true },
            );
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    const registry = AtomRegistry.make();
    Vitest.onTestFinished(() => registry.dispose());
    const runtime = makeRuntime({ baseUrl: "http://moku.test", plugins: [], fetch });
    const target = { connectionId: "host-a", notebookId: "n" };
    const first = runtime.notebook(target);
    Vitest.expect(runtime.notebook({ ...target })).toBe(first);
    const closeFirst = registry.mount(first);
    const closeSecond = registry.mount(runtime.notebook({ ...target }));
    await vi.waitFor(() => Vitest.expect(requests).toHaveLength(1));
    const result = registry.get(first);
    Vitest.expect(AsyncResult.isSuccess(result)).toBe(true);
    if (!AsyncResult.isSuccess(result)) throw new Error("Missing notebook handle");
    await vi.waitFor(() =>
      Vitest.expect(registry.get(result.value.state).value.ready).toBe(true),
    );
    closeFirst();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    Vitest.expect(requests[0].closed).toBe(false);
    const closeOtherHost = registry.mount(
      runtime.notebook({ connectionId: "host-b", notebookId: "n" }),
    );
    await vi.waitFor(() => Vitest.expect(requests).toHaveLength(2));
    Vitest.expect(requests[0].url).not.toBe(requests[1].url);
    closeSecond();
    await vi.waitFor(() => Vitest.expect(requests[0].closed).toBe(true));
    Vitest.expect(requests[1].closed).toBe(false);
    closeOtherHost();
    await vi.waitFor(() => Vitest.expect(requests[1].closed).toBe(true));
  },
);
