import * as React from "react";
import * as ReactDOMServer from "react-dom/server";
import type { ViewProps } from "@moku/plugin";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { FetchHttpClient } from "effect/http";
import * as CoreHost from "@moku/core/Host";
import { Context, Effect, Exit, Scope, Layer } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { Plugin } from "@moku/plugin";

const view = {
  id: "main",
  title: "Main",
  render: () => null,
};

async function host(plugins: readonly Plugin.Interface[]) {
  const registry = AtomRegistry.make();
  const scope = await Effect.runPromise(Scope.make());
  const instance = await Effect.runPromise(
    Plugin.load(plugins).pipe(
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
  return { state: () => registry.get(instance.state), close, registry, scope };
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
  "a standalone host can load and render a lazy plugin with a direct notebook",
  async () => {
    const loadView = vi.fn(async () => ({
      default: ({ notebook }: ViewProps) => notebook.id,
    }));
    const LazyView = React.lazy(loadView);
    const f = await host([
      Plugin.define({
        id: "portable",
        effect: (ctx) =>
          ctx.view.add({
            id: "identity",
            title: "Identity",
            render: (props) => React.createElement(LazyView, props),
          }),
      }),
    ]);
    const streams: { closed: boolean }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      Vitest.expect(new URL(request.url).pathname.endsWith("/events")).toBe(true);
      const stream = { closed: false };
      streams.push(stream);
      return new Response(
        new ReadableStream({
          start(controller) {
            const notebook = {
              id: "n",
              project_id: "p",
              name: "standalone.py",
              path: "standalone.py",
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
                if (!stream.closed) controller.close();
                stream.closed = true;
              },
              { once: true },
            );
          },
          cancel() {
            stream.closed = true;
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    const notebook = await Effect.runPromise(
      Effect.gen(function* () {
        const transport = yield* Layer.build(FetchHttpClient.layer);
        const host = yield* CoreHost.make({
          baseUrl: "http://standalone.test/api/marimo/v1",
        }).pipe(Effect.provideContext(transport));
        return yield* host.notebooks.attach("n");
      }).pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.provideService(AtomRegistry.AtomRegistry, f.registry),
        Effect.provideService(Scope.Scope, f.scope),
      ),
    );
    await vi.waitFor(() =>
      Vitest.expect(AsyncResult.isSuccess(f.registry.get(notebook.state))).toBe(true),
    );
    const view = f.state().views[0];
    Vitest.expect(view.key).toBe("portable/identity");
    Vitest.expect(loadView).not.toHaveBeenCalled();
    const render = () =>
      ReactDOMServer.renderToString(
        React.createElement(
          React.Suspense,
          { fallback: "Loading" },
          view.render({ notebook }),
        ),
      );
    Vitest.expect(render()).toContain("Loading");
    await vi.waitFor(() => Vitest.expect(loadView).toHaveBeenCalledOnce());
    await loadView.mock.results[0].value;
    Vitest.expect(render()).toContain("n");
    await f.close();
    Vitest.expect(streams).toHaveLength(2);
    Vitest.expect(streams.every((stream) => stream.closed)).toBe(true);
    Vitest.expect(f.state().views).toEqual([]);
  },
);

Vitest.test(
  "setup dependencies flow through load and atom resources use its registry",
  async () => {
    class Label extends Context.Service<Label, { readonly value: string }>()(
      "test/Label",
    ) {}
    class Suffix extends Context.Service<Suffix, { readonly value: string }>()(
      "test/Suffix",
    ) {}
    const labelState = Atom.make("");
    const first = Plugin.define({
      id: "first",
      effect: (ctx: Plugin.Context) =>
        Effect.gen(function* () {
          const label = yield* Label;
          yield* Atom.mount(labelState);
          const registry = yield* AtomRegistry.AtomRegistry;
          registry.set(labelState, label.value);
          yield* ctx.view.add({ ...view, title: registry.get(labelState) });
        }),
    });
    const second = Plugin.define({
      id: "second",
      effect: (ctx: Plugin.Context) =>
        Effect.gen(function* () {
          const suffix = yield* Suffix;
          yield* ctx.view.add({ ...view, id: suffix.value });
        }),
    });
    const registry = AtomRegistry.make();
    Vitest.onTestFinished(() => registry.dispose());
    await Effect.runPromise(
      Effect.gen(function* () {
        const loaded = yield* Plugin.load([first, second]);
        Vitest.expect(registry.get(loaded.state).views.map((view) => view.key)).toEqual(
          ["first/main", "second/extra"],
        );
        Vitest.expect(registry.get(labelState)).toBe("Injected");
      }).pipe(
        Effect.scoped,
        Effect.provideService(AtomRegistry.AtomRegistry, registry),
        Effect.provideService(Label, { value: "Injected" }),
        Effect.provideService(Suffix, { value: "extra" }),
      ),
    );
  },
);

Vitest.test("failed cleanup is isolated alongside failed setup", async () => {
  const f = await host([
    Plugin.define({
      id: "broken",
      effect: (ctx) =>
        Effect.gen(function* () {
          yield* ctx.view.add(view);
          yield* Effect.addFinalizer(() => Effect.die(new Error("cleanup failed")));
          return yield* Effect.fail(new Error("setup failed"));
        }),
    }),
    Plugin.define({ id: "healthy", effect: (ctx) => ctx.view.add(view) }),
  ]);
  Vitest.expect(f.state().views.map((view) => view.key)).toEqual(["healthy/main"]);
  Vitest.expect(f.state().failures[0].message).toContain("setup failed");
  Vitest.expect(f.state().failures[0].message).toContain("cleanup failed");
});

Vitest.test(
  "interrupting setup immediately releases its resources without activating later plugins",
  async () => {
    const registry = AtomRegistry.make();
    const scope = await Effect.runPromise(Scope.make());
    const controller = new AbortController();
    let acquired = false;
    let released = false;
    let later = false;
    const loading = Effect.runPromiseExit(
      Plugin.load([
        Plugin.define({
          id: "pending",
          effect: () =>
            Effect.gen(function* () {
              yield* Effect.acquireRelease(
                Effect.sync(() => {
                  acquired = true;
                }),
                () =>
                  Effect.sync(() => {
                    released = true;
                  }),
              );
              yield* Effect.never;
            }),
        }),
        Plugin.define({
          id: "later",
          effect: () =>
            Effect.sync(() => {
              later = true;
            }),
        }),
      ]).pipe(
        Effect.provideService(AtomRegistry.AtomRegistry, registry),
        Effect.provideService(Scope.Scope, scope),
      ),
      { signal: controller.signal },
    );
    Vitest.onTestFinished(async () => {
      controller.abort();
      await Effect.runPromise(Scope.close(scope, Exit.void));
      registry.dispose();
    });
    await vi.waitFor(() => Vitest.expect(acquired).toBe(true));
    controller.abort();
    Vitest.expect((await loading)._tag).toBe("Failure");
    Vitest.expect(released).toBe(true);
    Vitest.expect(later).toBe(false);
  },
);
