// @vitest-environment happy-dom
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import { DisplayView, setTheme } from "../src/index.ts";
import { loadRenderer } from "../src/internal/renderer.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const roots: ReturnType<typeof ReactDOMClient.createRoot>[] = [];
Vitest.afterEach(async () => {
  await React.act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

Vitest.test(
  "the generated bundle renders HTML and JSON using the application's React",
  async () => {
    setTheme("dark");
    const renderer = await loadRenderer();
    Vitest.expect(loadRenderer()).toBe(loadRenderer());
    Vitest.expect(typeof renderer.DisplayRenderer).toBe("function");
    const element = document.createElement("div");
    document.body.append(element);
    const root = ReactDOMClient.createRoot(element);
    roots.push(root);
    const shadow = () => element.querySelector(".moku-rich-output")?.shadowRoot;
    await React.act(async () => {
      root.render(
        <DisplayView
          data={{ mimetype: "text/html", data: "<strong>rich output</strong>" }}
        />,
      );
    });
    await vi.waitFor(() =>
      Vitest.expect(shadow()?.textContent).toContain("rich output"),
    );
    Vitest.expect(shadow()?.querySelector(".marimo.dark")).not.toBeNull();
    Vitest.expect(element.querySelector("strong")).toBeNull();
    Vitest.expect(shadow()?.querySelector("strong")?.textContent).toBe("rich output");
    Vitest.expect(
      document.head.querySelectorAll('style[title="marimo-moku-output-renderer"]'),
    ).toHaveLength(1);
    await React.act(async () => {
      root.render(
        <DisplayView data={{ mimetype: "application/json", data: '{"answer":42}' }} />,
      );
    });
    await vi.waitFor(() => Vitest.expect(shadow()?.textContent).toContain("answer"));
    Vitest.expect(shadow()?.textContent).toContain("42");
    await React.act(async () => {
      setTheme("light");
    });
    Vitest.expect(shadow()?.querySelector(".marimo.light")).not.toBeNull();
  },
  20000,
);

Vitest.test(
  "renderer sessions release native listeners and isolate historical widgets",
  async () => {
    const renderer = await loadRenderer();
    const sendComponentValues = vi.fn(async () => {});
    const options = {
      runtimeId: "current",
      assetUrl: (path: string) => path,
      sendComponentValues,
      invoke: async () => null,
      sendModelValue: async () => {},
    };
    const session = renderer.createSession(options);
    try {
      Vitest.expect(() => renderer.createSession(options)).toThrow("already owns");
      await session.handle({ op: "kernel-ready", ui_values: { "cell-0": 7 } });
      const dispatch = () =>
        document.dispatchEvent(
          new CustomEvent("marimo-value-ready", { detail: { objectId: "cell-0" } }),
        );
      dispatch();
      Vitest.expect(sendComponentValues).toHaveBeenCalledWith({
        objectIds: ["cell-0"],
        values: [7],
      });
      const element = document.createElement("div");
      document.body.append(element);
      const root = ReactDOMClient.createRoot(element);
      roots.push(root);
      await React.act(async () => {
        root.render(
          <renderer.DisplayRenderer
            session={session}
            runtimeId="previous"
            canInteract
            data={{
              mimetype: "text/html",
              data: '<marimo-ui-element object-id="cell-0"><marimo-slider></marimo-slider></marimo-ui-element>',
            }}
          />,
        );
      });
      Vitest.expect(element.querySelector("marimo-ui-element")).toBeNull();
      Vitest.expect(element.querySelector("iframe")?.getAttribute("sandbox")).toBe("");
      session.dispose();
      dispatch();
      Vitest.expect(sendComponentValues).toHaveBeenCalledOnce();
      const replacement = renderer.createSession({
        ...options,
        runtimeId: "replacement",
      });
      try {
        dispatch();
        Vitest.expect(sendComponentValues).toHaveBeenCalledOnce();
      } finally {
        replacement.dispose();
      }
    } finally {
      session.dispose();
    }
  },
);
