// Vendored from koaning/sketcher@b9d3e2101a8946c1c122953175f303e2eafba87b web/src/canvas/appearance.ts. Edit it there and rerun scripts/sketcher.ts.
export type Appearance = "system" | "light" | "dark";

/** Whether the host page is dark: JupyterLab and marimo themes first, then the OS setting. */
export function systemIsDark(): boolean {
  const body = document.body;
  const html = document.documentElement;
  const jp = body?.dataset.jpThemeLight;
  if (jp === "false") return true;
  if (jp === "true") return false;
  for (const el of [html, body]) {
    if (!el) continue;
    const theme = el.dataset.theme ?? el.dataset.colorMode;
    if (theme === "dark") return true;
    if (theme === "light") return false;
    if (el.classList.contains("dark") || el.classList.contains("dark-theme")) return true;
  }
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Calls `onChange` when the OS or host page theme may have changed. Returns a cleanup function. */
export function watchSystemAppearance(onChange: () => void): () => void {
  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  const observer = new MutationObserver(onChange);
  const opts = { attributes: true, attributeFilter: ["class", "data-theme", "data-color-mode", "data-jp-theme-light"] };
  observer.observe(document.documentElement, opts);
  if (document.body) observer.observe(document.body, opts);
  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}
