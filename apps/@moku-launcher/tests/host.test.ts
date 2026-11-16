import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import * as Application from "../src/app/Application.ts";

Vitest.test(
  "catalogs and notebook views share hosts until their last consumer closes",
  async () => {
    const requests: { url: string; closed: boolean }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === "/api/session")
        return Response.json({ authenticated: true });
      if (new URL(request.url).pathname === "/api/hosts") return Response.json([]);
      const entry = { url: request.url, closed: false };
      requests.push(entry);
      return new Response(
        new ReadableStream({
          start(controller) {
            const notebook = {
              id:
                new URL(request.url).pathname.match(/notebooks\/([^/]+)\//)?.[1] ?? "n",
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
    const application = Application.make({
      baseUrl: "http://moku.test",
      plugins: [],
      fetch,
    });
    const target = { connectionId: "host-a", notebookId: "n" };
    const first = application.notebook(target);
    Vitest.expect(application.notebook({ ...target })).toBe(first);
    const closeFirst = registry.mount(first);
    const closeSecond = registry.mount(application.notebook({ ...target }));
    await vi.waitFor(() => Vitest.expect(requests).toHaveLength(2));
    const result = registry.get(first);
    Vitest.expect(AsyncResult.isSuccess(result)).toBe(true);
    if (!AsyncResult.isSuccess(result)) throw new Error("Missing notebook handle");
    await vi.waitFor(() =>
      Vitest.expect(AsyncResult.isSuccess(registry.get(result.value.state))).toBe(true),
    );
    const session = registry.get(application.workspace);
    if (!AsyncResult.isSuccess(session)) throw new Error("Missing workspace");
    const closeCatalog = registry.mount(session.value.catalog("host-a"));
    const closeAnotherNotebook = registry.mount(
      application.notebook({ connectionId: "host-a", notebookId: "m" }),
    );
    await vi.waitFor(() => Vitest.expect(requests).toHaveLength(3));
    Vitest.expect(
      requests.filter((request) => request.url.endsWith("/host-a/events")),
    ).toHaveLength(1);
    closeCatalog();
    closeFirst();
    closeSecond();
    await vi.waitFor(() => Vitest.expect(requests[1].closed).toBe(true));
    Vitest.expect(requests[0].closed).toBe(false);
    Vitest.expect(requests[2].closed).toBe(false);
    const closeOtherHost = registry.mount(
      application.notebook({ connectionId: "host-b", notebookId: "n" }),
    );
    await vi.waitFor(() => Vitest.expect(requests).toHaveLength(5));
    closeAnotherNotebook();
    await vi.waitFor(() =>
      Vitest.expect(requests.slice(0, 3).every((request) => request.closed)).toBe(true),
    );
    Vitest.expect(requests[3].closed).toBe(false);
    closeOtherHost();
    await vi.waitFor(() =>
      Vitest.expect(requests.every((request) => request.closed)).toBe(true),
    );
  },
);
