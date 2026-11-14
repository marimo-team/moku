import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { makeRuntime } from "../src/app/runtime.ts";

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
    await vi.waitFor(() => Vitest.expect(requests).toHaveLength(2));
    const result = registry.get(first);
    Vitest.expect(AsyncResult.isSuccess(result)).toBe(true);
    if (!AsyncResult.isSuccess(result)) throw new Error("Missing notebook handle");
    await vi.waitFor(() =>
      Vitest.expect(AsyncResult.isSuccess(registry.get(result.value.state))).toBe(true),
    );
    closeFirst();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    Vitest.expect(requests[0].closed).toBe(false);
    const closeOtherHost = registry.mount(
      runtime.notebook({ connectionId: "host-b", notebookId: "n" }),
    );
    await vi.waitFor(() => Vitest.expect(requests).toHaveLength(4));
    Vitest.expect(requests[0].url).not.toBe(requests[2].url);
    closeSecond();
    await vi.waitFor(() => Vitest.expect(requests[0].closed).toBe(true));
    Vitest.expect(requests[2].closed).toBe(false);
    closeOtherHost();
    await vi.waitFor(() => Vitest.expect(requests[2].closed).toBe(true));
  },
);
