// @vitest-environment happy-dom
import { beforeEach, expect, onTestFinished, test, vi } from "vite-plus/test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { Plugin } from "@moku/plugin";
import { App } from "../src/app/App.tsx";
import { makeRuntime } from "../src/app/runtime.ts";
import { parseRoute, viewHref, type Route } from "../src/app/routes.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
beforeEach(() => localStorage.clear());

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

test("the shared picker updates every notebook link and remembers the selection", async () => {
  const { element, requests } = await mount({ kind: "catalog" });
  await vi.waitFor(() =>
    expect(element.querySelectorAll(".notebook-row")).toHaveLength(2),
  );
  expect(
    [...element.querySelectorAll(".host-section")].map((section) =>
      section.getAttribute("aria-label"),
    ),
  ).toEqual(["First host", "Second host"]);
  expect(
    [...element.querySelectorAll(".host-heading h2")].map(
      (heading) => heading.textContent,
    ),
  ).toEqual(["localhost:2718", "localhost:2719"]);
  expect(element.querySelector(".host-facts")?.textContent).toContain("PID 1234");
  expect(
    [...element.querySelectorAll(".notebook-path")].map((path) => path.textContent),
  ).toEqual(["example.py", "/other/project/example.py"]);
  expect(element.querySelector("time")?.dateTime).toBe("2026-11-12T12:00:00Z");
  expect(element.querySelectorAll("time")).toHaveLength(1);
  const picker = element.querySelector("select")!;
  expect(picker.value).toBe("host");
  expect(element.querySelectorAll("[popover]")).toHaveLength(0);
  const buttons = element.querySelectorAll<HTMLButtonElement>(".notebook-open");
  expect(buttons[0].disabled).toBe(false);
  expect(buttons[1].disabled).toBe(true);
  await act(async () => {
    picker.value = "test/identity";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const links = [...element.querySelectorAll<HTMLAnchorElement>("a.notebook-open")];
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
  const next = await mount({ kind: "catalog" });
  await vi.waitFor(() =>
    expect(next.element.querySelector("select")?.value).toBe("test/identity"),
  );
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
  expect(view.element.querySelector("select")?.value).toBe("test/identity");
  expect(view.element.querySelector('option[value="host"]')).toBeNull();
  expect(view.element.querySelector(".view-notebook")?.textContent).toBe("example.py");
  expect(view.requests.filter((path) => path.endsWith("/events"))).toEqual([
    "/api/hosts/b/notebooks/n/events",
  ]);
  expect(view.element.querySelector(".view-breadcrumbs a")?.getAttribute("href")).toBe(
    "/",
  );
  await view.close();
  await vi.waitFor(() =>
    expect(view.closed).toContain("/api/hosts/b/notebooks/n/events"),
  );
});

test("Host opens the chosen notebook without opening any notebook streams", async () => {
  const { element, requests } = await mount({ kind: "catalog" });
  await vi.waitFor(() =>
    expect(element.querySelectorAll(".notebook-open")).toHaveLength(2),
  );
  await act(async () =>
    element.querySelector<HTMLButtonElement>(".notebook-open")!.click(),
  );
  await vi.waitFor(() => expect(requests).toContain("/api/hosts/a/notebooks/n/open"));
  expect(requests.filter((path) => path.includes("/notebooks/"))).toEqual([
    "/api/hosts/a/notebooks/n/open",
  ]);
});

test("a removed preferred view falls back to Host", async () => {
  localStorage.setItem("moku:open-with", "removed/view");
  const { element } = await mount({ kind: "catalog" });
  await vi.waitFor(() => expect(element.querySelector("select")?.value).toBe("host"));
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

test("existing notebook links resolve to the renamed plugins", () => {
  const target = { connectionId: "host", notebookId: "notebook" };
  for (const [previous, current] of [
    ["dag/graph", "graph-explainer/graph"],
    ["editor/notebook", "notebook/notebook"],
  ]) {
    expect(parseRoute(new URL(viewHref(target, previous), "http://moku.test"))).toEqual(
      {
        kind: "view",
        target,
        viewKey: current,
      },
    );
  }
});
