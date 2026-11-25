// @vitest-environment happy-dom
import { HttpClient, HttpServerResponse } from "effect/http";
import { notebookEvents } from "../../../packages/@moku-core/tests/fixtures.ts";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import * as React from "react";
import * as ReactRouter from "react-router";
import * as ReactRouterDOM from "react-router/dom";
import * as ReactDOMClient from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/reactivity";
import { Plugin, type ViewProps } from "@moku/plugin";
import { Effect, Layer } from "effect";
import { App } from "../src/app/App.tsx";
import * as Application from "../src/app/Application.ts";
import { parseRoute, viewHref, type Route } from "../src/app/routes.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

async function mount(route: Route) {
  const requests: string[] = [];
  const closed: string[] = [];
  const notebooks: ViewProps["notebook"][] = [];
  function Identity({ notebook }: ViewProps) {
    React.useEffect(() => {
      notebooks.push(notebook);
    }, [notebook]);
    return <h1>{notebook.id}</h1>;
  }
  function respond(path: string, signal: AbortSignal) {
    requests.push(path);
    if (path === "/api/session")
      return HttpServerResponse.jsonUnsafe({ authenticated: true });
    if (path === "/api/hosts")
      return HttpServerResponse.jsonUnsafe([
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
    if (path.endsWith("/open"))
      return HttpServerResponse.jsonUnsafe({ url: "http://host.test/" });
    if (!path.endsWith("/events")) throw new Error(`Unexpected request to ${path}`);
    signal.addEventListener("abort", () => closed.push(path), { once: true });
    const firstHost = path.includes("/hosts/a/");
    return notebookEvents({
      id: "n",
      project_id: "p",
      name: "example.py",
      path: firstHost ? "example.py" : "/other/project/example.py",
      operations: firstHost ? ["notebook.open"] : [],
      modified_at: firstHost ? "2026-11-12T12:00:00Z" : null,
    });
  }
  const client = HttpClient.make((request, url, signal) =>
    Effect.sync(() =>
      HttpServerResponse.toClientResponse(respond(url.pathname, signal), { request }),
    ),
  );
  const application = Application.make({
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
            yield* ctx.view.add({
              id: "other",
              title: "Other",
              render: Identity,
            });
          }),
      }),
    ],
  });
  const registry = AtomRegistry.make({
    initialValues: [
      Atom.initialValue(
        Application.runtime.layer,
        Layer.succeed(HttpClient.HttpClient, client),
      ),
    ],
  });
  const element = document.createElement("div");
  document.body.append(element);
  const root = ReactDOMClient.createRoot(element);
  const router = ReactRouter.createMemoryRouter(
    [{ path: "*", element: <App application={application} /> }],
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

async function openMenu(trigger: HTMLButtonElement) {
  await React.act(async () => {
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
  });
  return document.querySelector<HTMLElement>('[role="menu"]')!;
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
      Vitest.expect(view.element.querySelector("h1")?.textContent).toBe("n"),
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
      "/api/hosts/a/events",
      "/api/hosts/a/notebooks/n/events",
    ]);
    Vitest.expect(view.requests.filter((path) => path === "/api/session")).toHaveLength(
      1,
    );
  },
);

Vitest.test(
  "each notebook offers Host and its plugin links in its open menu",
  async () => {
    const { element, requests, router } = await mount({ kind: "catalog" });
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
    Vitest.expect(element.querySelector("select")).toBeNull();
    const buttons = element.querySelectorAll<HTMLButtonElement>(".notebook-open");
    const menu = await openMenu(buttons[1]);
    const host = menu.querySelector('[role="menuitem"]')!;
    Vitest.expect(host.getAttribute("aria-disabled")).toBe("true");
    const links = [...menu.querySelectorAll<HTMLAnchorElement>("a")];
    Vitest.expect(links.map((link) => link.textContent)).toEqual(["Identity", "Other"]);
    Vitest.expect(links.map((link) => parseRoute(new URL(link.href)))).toEqual(
      ["test/identity", "test/other"].map((viewKey) => ({
        kind: "view",
        target: { connectionId: "b", notebookId: "n" },
        viewKey,
      })),
    );
    Vitest.expect(requests.some((path) => path.includes("/notebooks/"))).toBe(false);
    await React.act(async () => links[1].click());
    Vitest.expect(router.state.location.search).toContain("host=b");
    Vitest.expect(element.querySelector("select")?.value).toBe("test/other");
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
      Vitest.expect(view.element.querySelector("h1")?.textContent).toBe("n"),
    );
    Vitest.expect(view.element.querySelector(".catalog-page")).toBeNull();
    Vitest.expect(view.element.querySelector("select")?.value).toBe("test/identity");
    Vitest.expect(view.element.querySelector('option[value="host"]')).toBeNull();
    Vitest.expect(view.element.querySelector(".view-notebook")?.textContent).toBe(
      "example.py",
    );
    Vitest.expect(view.requests.filter((path) => path.endsWith("/events"))).toEqual([
      "/api/hosts/b/events",
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
    const menu = await openMenu(
      element.querySelector<HTMLButtonElement>(".notebook-open")!,
    );
    const host = menu.querySelector<HTMLElement>('[role="menuitem"]')!;
    Vitest.expect(host.textContent).toContain("Host");
    await React.act(async () => host.click());
    await vi.waitFor(() =>
      Vitest.expect(requests).toContain("/api/hosts/a/notebooks/n/open"),
    );
    Vitest.expect(requests.filter((path) => path.includes("/notebooks/"))).toEqual([
      "/api/hosts/a/notebooks/n/open",
    ]);
  },
);

Vitest.test("Add host opens the connection form from the catalog header", async () => {
  const { element } = await mount({ kind: "catalog" });
  const trigger = element.querySelector<HTMLButtonElement>("header .add-host-button")!;
  await React.act(async () => trigger.click());
  const dialog = element.querySelector("dialog[open]")!;
  Vitest.expect(dialog.querySelector('input[name="url"]')).not.toBeNull();
  Vitest.expect(dialog.querySelector('input[type="password"]')).not.toBeNull();
  await React.act(async () =>
    dialog.querySelector<HTMLButtonElement>('button[type="button"]')!.click(),
  );
  Vitest.expect(element.querySelector("dialog[open]")).toBeNull();
});

Vitest.test(
  "view URLs preserve identifiers and malformed routes stay unavailable",
  () => {
    const target = { connectionId: "host +/&", notebookId: "notebook/%?雪" };
    const viewKey = "plugin%2Fone/view%2Fone";
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
    ["graph-explainer/graph", "graph-explainer/graph"],
    ["editor/notebook", "notebook/notebook"],
    ["notebook/notebook", "notebook/notebook"],
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

Vitest.test("an unavailable view can be switched to a registered view", async () => {
  const view = await mount({
    kind: "view",
    target: { connectionId: "a", notebookId: "n" },
    viewKey: "removed/view",
  });
  const picker = view.element.querySelector<HTMLSelectElement>(
    'select[aria-label="Switch view"]',
  )!;
  Vitest.expect(picker.selectedOptions[0].textContent).toBe("Unavailable view");
  await React.act(async () => {
    picker.value = "test/identity";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await vi.waitFor(() =>
    Vitest.expect(view.element.querySelector("h1")?.textContent).toBe("n"),
  );
});
