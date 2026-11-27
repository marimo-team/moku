import { Effect, Layer } from "effect";
// @vitest-environment happy-dom
import { HttpClient, HttpServerResponse } from "effect/http";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";

import { notebookEvents } from "../../../packages/@moku-core/tests/fixtures.ts";
import * as Application from "../src/app/Application.ts";

Vitest.test(
  "catalogs and notebook views share hosts until their last consumer closes",
  async () => {
    const requests: { path: string; signal: AbortSignal }[] = [];
    function respond(path: string, signal: AbortSignal) {
      if (path === "/api/session")
        return HttpServerResponse.jsonUnsafe({ authenticated: true });
      if (path === "/api/hosts") return HttpServerResponse.jsonUnsafe([]);
      if (!path.endsWith("/events")) throw new Error(`Unexpected request to ${path}`);
      requests.push({ path, signal });
      return notebookEvents({
        id: path.match(/notebooks\/([^/]+)\//)?.[1] ?? "n",
        project_id: "p",
        name: "example.py",
        path: "example.py",
        operations: [],
        modified_at: null,
      });
    }
    const client = HttpClient.make((request, url, signal) =>
      Effect.sync(() =>
        HttpServerResponse.toClientResponse(respond(url.pathname, signal), { request }),
      ),
    );
    const registry = AtomRegistry.make({
      initialValues: [
        Atom.initialValue(
          Application.runtime.layer,
          Layer.succeed(HttpClient.HttpClient, client),
        ),
      ],
    });
    Vitest.onTestFinished(() => registry.dispose());
    const application = Application.make({
      plugins: [],
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
      requests.filter((request) => request.path.endsWith("/host-a/events")),
    ).toHaveLength(1);
    closeCatalog();
    closeFirst();
    closeSecond();
    await vi.waitFor(() => Vitest.expect(requests[1].signal.aborted).toBe(true));
    Vitest.expect(requests[0].signal.aborted).toBe(false);
    Vitest.expect(requests[2].signal.aborted).toBe(false);
    const closeOtherHost = registry.mount(
      application.notebook({ connectionId: "host-b", notebookId: "n" }),
    );
    await vi.waitFor(() => Vitest.expect(requests).toHaveLength(5));
    closeAnotherNotebook();
    await vi.waitFor(() =>
      Vitest.expect(
        requests.slice(0, 3).every((request) => request.signal.aborted),
      ).toBe(true),
    );
    Vitest.expect(requests[3].signal.aborted).toBe(false);
    closeOtherHost();
    await vi.waitFor(() =>
      Vitest.expect(requests.every((request) => request.signal.aborted)).toBe(true),
    );
  },
);
