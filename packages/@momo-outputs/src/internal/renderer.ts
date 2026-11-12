import type { Theme } from "../types.ts";

type Renderer = typeof import("../../dist/renderer.js");
let bundle: Promise<Renderer> | undefined;
let theme: Theme | undefined;

export function setTheme(next: Theme): void {
  theme = next;
  // Appearance changes should not load the rich renderer before it is needed.
  void bundle?.then((renderer) => renderer.setTheme(next)).catch(() => {});
}

export function loadRenderer(): Promise<Renderer> {
  return (bundle ??= load());
}

async function load(): Promise<Renderer> {
  const { default: css } = await import("../../dist/renderer.css?inline");
  if (!document.head.querySelector('style[title="momo-output-renderer"]')) {
    const style = document.createElement("style");
    // Marimo copies titled stylesheets into its output plugins' shadow roots.
    style.title = "momo-output-renderer";
    style.textContent = css;
    document.head.append(style);
  }
  const renderer = await import("../../dist/renderer.js");
  renderer.setTheme(
    theme ?? (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
  );
  return renderer;
}
