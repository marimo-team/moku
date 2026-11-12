// @vitest-environment happy-dom
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import * as ReactRouter from "react-router";
import * as ReactRouterDOM from "react-router/dom";
import * as Vitest from "vite-plus/test";
import { RegistryContext } from "@effect/atom-react";
import { Effect } from "effect";
import { RequestError } from "@moku/core";
import { setup } from "../../../../packages/@moku-editor/tests/fixture.ts";
import { useDraftNavigationGuard } from "../../src/plugins/notebook/useDraftNavigationGuard.ts";

Vitest.vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

async function mount(fail = false) {
  const h = await setup(
    fail ? () => Effect.fail(new RequestError({ message: "offline" })) : undefined,
  );
  function Editor() {
    useDraftNavigationGuard(h.model, false);
    return <ReactRouter.Link to="/graph">Graph</ReactRouter.Link>;
  }
  const router = ReactRouter.createMemoryRouter(
    [
      { path: "/", element: <Editor /> },
      { path: "/graph", element: <h1>Graph</h1> },
    ],
    { initialEntries: ["/graph", "/"], initialIndex: 1 },
  );
  const element = document.createElement("div");
  document.body.append(element);
  const root = ReactDOMClient.createRoot(element);
  Vitest.onTestFinished(async () => {
    await React.act(async () => root.unmount());
    router.dispose();
    element.remove();
  });
  await React.act(async () => {
    root.render(
      <RegistryContext.Provider value={h.registry}>
        <ReactRouterDOM.RouterProvider router={router} />
      </RegistryContext.Provider>,
    );
  });
  await React.act(async () => h.change("edited"));
  return { h, router, element };
}

Vitest.test("keeps the editor mounted until pending edits are confirmed", async () => {
  const { h, router, element } = await mount();
  await React.act(async () => element.querySelector("a")!.click());
  await Vitest.vi.waitFor(() => Vitest.expect(h.calls).toHaveLength(1));
  Vitest.expect(router.state.location.pathname).toBe("/");
  Vitest.expect(element.querySelector("a")).not.toBeNull();
  await React.act(async () => {
    h.calls[0].respond(2);
    h.publish("edited", 2);
  });
  await Vitest.vi.waitFor(() =>
    Vitest.expect(router.state.location.pathname).toBe("/graph"),
  );
  Vitest.expect(h.code()).toBe("edited");
});

Vitest.test("a failed flush blocks Back and preserves the draft", async () => {
  const { h, router, element } = await mount(true);
  await React.act(async () => {
    await router.navigate(-1);
  });
  await Vitest.vi.waitFor(() =>
    Vitest.expect(h.registry.get(h.model.state).status.status).toBe("error"),
  );
  Vitest.expect(router.state.location.pathname).toBe("/");
  Vitest.expect(element.querySelector("a")).not.toBeNull();
  Vitest.expect(h.code()).toBe("edited");
});
