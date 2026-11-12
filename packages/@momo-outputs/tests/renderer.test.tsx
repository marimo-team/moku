// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { DisplayView, setTheme } from "../src/index.ts";
import { loadRenderer } from "../src/internal/renderer.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

test("the generated bundle renders HTML and JSON using the application's React", async () => {
  setTheme("dark");
  const renderer = await loadRenderer();
  expect(loadRenderer()).toBe(loadRenderer());
  expect(typeof renderer.DisplayRenderer).toBe("function");
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  roots.push(root);
  await act(async () => {
    root.render(
      <DisplayView
        data={{ mimetype: "text/html", data: "<strong>rich output</strong>" }}
      />,
    );
  });
  await vi.waitFor(() => expect(element.textContent).toContain("rich output"));
  expect(element.querySelector(".marimo.dark")).not.toBeNull();
  expect(
    document.head.querySelectorAll('style[title="momo-output-renderer"]'),
  ).toHaveLength(1);
  await act(async () => {
    root.render(
      <DisplayView data={{ mimetype: "application/json", data: '{"answer":42}' }} />,
    );
  });
  await vi.waitFor(() => expect(element.textContent).toContain("answer"));
  expect(element.textContent).toContain("42");
  await act(async () => {
    setTheme("light");
  });
  expect(element.querySelector(".marimo.light")).not.toBeNull();
}, 20000);
