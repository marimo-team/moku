// @vitest-environment happy-dom
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import * as React from "react";
import * as ReactRouter from "react-router";
import * as ReactRouterDOM from "react-router/dom";
import * as ReactDOMClient from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { Plugin, type ViewProps } from "@moku/plugin";
import { Effect } from "effect";
import { App } from "../src/app/App.tsx";
import { makeRuntime } from "../src/app/runtime.ts";
import { parseRoute, viewHref, type Route } from "../src/app/routes.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
Vitest.beforeEach(() => localStorage.clear());

async function mount(route: Route) {
  const requests: string[] = [];
  const closed: string[] = [];
  const notebooks: ViewProps["notebook"][] = [];
  function Identity({ notebook }: ViewProps) {
    React.useEffect(() => {
      notebooks.push(notebook);
    }, [notebook]);
    return (
      <h1>
        {notebook.target.connectionId}:{notebook.target.notebookId}
      </h1>
    );
  }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    requests.push(path);
    if (path === "/api/session") return Response.json({ authenticated: true });
    if (path === "/api/hosts")
      return Response.json([
        {
          id: "a",
          name: "First host",
          url: "http://localhost:2718",
          source: "local",
          pid: 1234,
        },
        {
          id: "b",
          name: "Second host",
          url: "http://localhost:2719",
          source: "manual",
        },
      ]);
    if (path.endsWith("/open")) return Response.json({ success: true });
    return new Response(
      new ReadableStream({
        start(controller) {
          const notebook = {
            id: "n",
            project_id: "p",
            name: "example.py",
            path: path.includes("/hosts/a/")
              ? "example.py"
              : "/other/project/example.py",
            operations: path.includes("/hosts/a/") ? ["notebook.open"] : [],
            updated_at: path.includes("/hosts/a/") ? "2026-11-12T12:00:00Z" : null,
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
          Effect.gen(function* () {
            yield* ctx.view.add({
              id: "identity",
              title: "Identity",
              render: Identity,
            });
            yield* ctx.view.add({ id: "other", title: "Other", render: Identity });
          }),
      }),
    ],
  });
  const registry = AtomRegistry.make();
  const element = document.createElement("div");
  document.body.append(element);
  const root = ReactDOMClient.createRoot(element);
  const router = ReactRouter.createMemoryRouter(
    [{ path: "*", element: <App runtime={runtime} /> }],
    {
      initialEntries: [
        route.kind === "view" ? viewHref(route.target, route.viewKey) : "/",
      ],
    },
  );
  const close = async () => {
    await React.act(async () => root.unmount());
    registry.dispose();
    router.dispose();
    element.remove();
  };
  Vitest.onTestFinished(close);
  await React.act(async () => {
    root.render(
      <RegistryContext.Provider value={registry}>
        <ReactRouterDOM.RouterProvider router={router} />
      </RegistryContext.Provider>,
    );
  });
  return { element, requests, closed, close, router, notebooks };
}

Vitest.test(
  "switching views and traversing history retains the notebook client and stream",
  async () => {
    const view = await mount({
      kind: "view",
      target: { connectionId: "a", notebookId: "n" },
      viewKey: "test/identity",
    });
    await vi.waitFor(() =>
      Vitest.expect(view.element.querySelector("h1")?.textContent).toBe("a:n"),
    );
    const picker = view.element.querySelector("select")!;
    await React.act(async () => {
      picker.value = "test/other";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    Vitest.expect(view.router.state.location.search).toContain("view=test%2Fother");
    Vitest.expect(view.element.querySelector("select")?.value).toBe("test/other");
    await React.act(async () => {
      await view.router.navigate(-1);
    });
    Vitest.expect(view.element.querySelector("select")?.value).toBe("test/identity");
    await React.act(async () => {
      await view.router.navigate(1);
    });
    Vitest.expect(view.element.querySelector("select")?.value).toBe("test/other");
    Vitest.expect(view.notebooks).toHaveLength(4);
    Vitest.expect(new Set(view.notebooks).size).toBe(1);
    Vitest.expect(view.closed).toEqual([]);
    Vitest.expect(view.requests.filter((path) => path.endsWith("/events"))).toEqual([
      "/api/hosts/a/notebooks/n/events",
    ]);
    Vitest.expect(view.requests.filter((path) => path === "/api/session")).toHaveLength(
      1,
    );
  },
);

Vitest.test(
  "the shared picker updates every notebook link and remembers the selection",
  async () => {
    const { element, requests } = await mount({ kind: "catalog" });
    await vi.waitFor(() =>
      Vitest.expect(element.querySelectorAll(".notebook-row")).toHaveLength(2),
    );
    Vitest.expect(
      [...element.querySelectorAll(".host-section")].map((section) =>
        section.getAttribute("aria-label"),
      ),
    ).toEqual(["First host", "Second host"]);
    Vitest.expect(
      [...element.querySelectorAll(".host-heading h2")].map(
        (heading) => heading.textContent,
      ),
    ).toEqual(["localhost:2718", "localhost:2719"]);
    Vitest.expect(element.querySelector(".host-facts")?.textContent).toContain(
      "PID 1234",
    );
    Vitest.expect(
      [...element.querySelectorAll(".notebook-path")].map((path) => path.textContent),
    ).toEqual(["example.py", "/other/project/example.py"]);
    Vitest.expect(element.querySelector("time")?.dateTime).toBe("2026-11-12T12:00:00Z");
    Vitest.expect(element.querySelectorAll("time")).toHaveLength(1);
    const picker = element.querySelector("select")!;
    Vitest.expect(picker.value).toBe("host");
    Vitest.expect(element.querySelectorAll("[popover]")).toHaveLength(0);
    const buttons = element.querySelectorAll<HTMLButtonElement>(".notebook-open");
    Vitest.expect(buttons[0].disabled).toBe(false);
    Vitest.expect(buttons[1].disabled).toBe(true);
    await React.act(async () => {
      picker.value = "test/identity";
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const links = [...element.querySelectorAll<HTMLAnchorElement>("a.notebook-open")];
    Vitest.expect(
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
    Vitest.expect(requests.some((path) => path.includes("/notebooks/"))).toBe(false);
    const next = await mount({ kind: "catalog" });
    await vi.waitFor(() =>
      Vitest.expect(next.element.querySelector("select")?.value).toBe("test/identity"),
    );
  },
);

Vitest.test(
  "a direct view URL mounts only that notebook and releases its stream on close",
  async () => {
    const route = parseRoute(
      new URL(
        viewHref({ connectionId: "b", notebookId: "n" }, "test/identity"),
        "http://moku.test",
      ),
    );
    const view = await mount(route);
    await vi.waitFor(() =>
      Vitest.expect(view.element.querySelector("h1")?.textContent).toBe("b:n"),
    );
    Vitest.expect(view.element.querySelector(".catalog-page")).toBeNull();
    Vitest.expect(view.element.querySelector("select")?.value).toBe("test/identity");
    Vitest.expect(view.element.querySelector('option[value="host"]')).toBeNull();
    Vitest.expect(view.element.querySelector(".view-notebook")?.textContent).toBe(
      "example.py",
    );
    Vitest.expect(view.requests.filter((path) => path.endsWith("/events"))).toEqual([
      "/api/hosts/b/notebooks/n/events",
    ]);
    Vitest.expect(
      view.element.querySelector(".view-breadcrumbs a")?.getAttribute("href"),
    ).toBe("/");
    await view.close();
    await vi.waitFor(() =>
      Vitest.expect(view.closed).toContain("/api/hosts/b/notebooks/n/events"),
    );
  },
);

Vitest.test(
  "Host opens the chosen notebook without opening any notebook streams",
  async () => {
    const { element, requests } = await mount({ kind: "catalog" });
    await vi.waitFor(() =>
      Vitest.expect(element.querySelectorAll(".notebook-open")).toHaveLength(2),
    );
    await React.act(async () =>
      element.querySelector<HTMLButtonElement>(".notebook-open")!.click(),
    );
    await vi.waitFor(() =>
      Vitest.expect(requests).toContain("/api/hosts/a/notebooks/n/open"),
    );
    Vitest.expect(requests.filter((path) => path.includes("/notebooks/"))).toEqual([
      "/api/hosts/a/notebooks/n/open",
    ]);
  },
);

Vitest.test("a removed preferred view falls back to Host", async () => {
  localStorage.setItem("moku:open-with", "removed/view");
  const { element } = await mount({ kind: "catalog" });
  await vi.waitFor(() =>
    Vitest.expect(element.querySelector("select")?.value).toBe("host"),
  );
});

Vitest.test(
  "view URLs preserve identifiers and malformed routes stay unavailable",
  () => {
    const target = { connectionId: "host +/&", notebookId: "notebook/%?雪" };
    const viewKey = "plugin%2Fone/view";
    Vitest.expect(
      parseRoute(new URL(viewHref(target, viewKey), "http://moku.test")),
    ).toEqual({
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
      Vitest.expect(parseRoute(new URL(path, "http://moku.test"))).toEqual({
        kind: "missing",
      });
    }
  },
);

Vitest.test("existing notebook links resolve to the renamed plugins", () => {
  const target = { connectionId: "host", notebookId: "notebook" };
  for (const [previous, current] of [
    ["dag/graph", "graph-explainer/graph"],
    ["editor/notebook", "notebook/notebook"],
  ]) {
    Vitest.expect(
      parseRoute(new URL(viewHref(target, previous), "http://moku.test")),
    ).toEqual({
      kind: "view",
      target,
      viewKey: current,
    });
  }
});
