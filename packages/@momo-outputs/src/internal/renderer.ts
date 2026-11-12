/**
 * Load one shared marimo renderer and stylesheet, preserving the selected theme.
 *
 * @module
 */
import type { Theme } from "../types.ts";

type Renderer = typeof import("../../dist/renderer.js");
let bundle: Promise<Renderer> | undefined;
let theme: Theme | undefined;

/**
 * Sets the theme for all rich outputs on the page.
 *
 * The choice is remembered without loading the renderer. Until a theme is set,
 * the renderer reads `document.documentElement.dataset.theme` on first load.
 *
 * @example Match the application's appearance
 * ```ts
 * import { setTheme } from "@momo/outputs";
 *
 * setTheme("dark");
 * ```
 */
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
