// @vitest-environment happy-dom
import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { Plugin } from "@moku/plugin";
import { App } from "../src/app/App.tsx";
import { makeRuntime } from "../src/app/runtime.ts";
import { parseRoute, viewHref, type Route } from "../src/app/routes.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

async function mount(route: Route) {
  const requests: string[] = [];
  const closed: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    requests.push(path);
    if (path === "/api/session") return Response.json({ authenticated: true });
    if (path === "/api/hosts")
      return Response.json([
        { id: "a", name: "First host", url: "http://localhost:2718", source: "local" },
        {
          id: "b",
          name: "Second host",
          url: "http://localhost:2719",
          source: "manual",
        },
      ]);
    return new Response(
      new ReadableStream({
        start(controller) {
          const notebook = {
            id: "n",
            project_id: "p",
            name: "example.py",
            path: "examples/example.py",
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
              closed.push(path);
              controller.close();
            },
            { once: true },
          );
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  };
  const runtime = makeRuntime({
    baseUrl: "http://moku.test",
    fetch,
    plugins: [
      Plugin.define({
        id: "test",
        effect: (ctx) =>
          ctx.view.add({
            id: "identity",
            title: "Identity",
            render: ({ notebook }) => (
              <h1>
                {notebook.target.connectionId}:{notebook.target.notebookId}
              </h1>
            ),
          }),
      }),
    ],
  });
  const registry = AtomRegistry.make();
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  const close = async () => {
    await act(async () => root.unmount());
    registry.dispose();
    element.remove();
  };
  onTestFinished(close);
  await act(async () => {
    root.render(
      <RegistryContext.Provider value={registry}>
        <App runtime={runtime} route={route} />
      </RegistryContext.Provider>,
    );
  });
  return { element, requests, closed, close };
}

test("the catalog groups notebooks by host and links each registered view", async () => {
  const { element, requests } = await mount({ kind: "catalog" });
  await vi.waitFor(() =>
    expect(element.querySelectorAll(".notebook-row")).toHaveLength(2),
  );
  expect(
    [...element.querySelectorAll(".host-heading h2")].map((h) => h.textContent),
  ).toEqual(["First host", "Second host"]);
  expect(element.querySelector("input, select")).toBeNull();
  const links = [...element.querySelectorAll<HTMLAnchorElement>(".open-with a")];
  expect(
    links.map((link) =>
      parseRoute(new URL(link.getAttribute("href")!, "http://moku.test")),
    ),
  ).toEqual(
    ["a", "b"].map((connectionId) => ({
      kind: "view",
      target: { connectionId, notebookId: "n" },
      viewKey: "test/identity",
    })),
  );
  expect(requests.some((path) => path.includes("/notebooks/"))).toBe(false);
});

test("a direct view URL mounts only that notebook and releases its stream on close", async () => {
  const route = parseRoute(
    new URL(
      viewHref({ connectionId: "b", notebookId: "n" }, "test/identity"),
      "http://moku.test",
    ),
  );
  const view = await mount(route);
  await vi.waitFor(() =>
    expect(view.element.querySelector("h1")?.textContent).toBe("b:n"),
  );
  expect(view.element.querySelector(".catalog-page")).toBeNull();
  expect(view.requests.filter((path) => path.endsWith("/events"))).toEqual([
    "/api/hosts/b/notebooks/n/events",
  ]);
  expect(view.element.querySelector(".back-link")?.getAttribute("href")).toBe("/");
  await view.close();
  await vi.waitFor(() =>
    expect(view.closed).toContain("/api/hosts/b/notebooks/n/events"),
  );
});

test("view URLs preserve identifiers and malformed routes stay unavailable", () => {
  const target = { connectionId: "host +/&", notebookId: "notebook/%?雪" };
  const viewKey = "plugin%2Fone/view";
  expect(parseRoute(new URL(viewHref(target, viewKey), "http://moku.test"))).toEqual({
    kind: "view",
    target,
    viewKey,
  });
  for (const path of [
    "/unknown",
    "/notebook/n",
    "/notebook/%ZZ?host=a&view=b",
    "/notebook/n?host=a&view=",
  ]) {
    expect(parseRoute(new URL(path, "http://moku.test"))).toEqual({ kind: "missing" });
  }
});
