import type { Target } from "@moku/core/Notebook";

export type Route =
  | { readonly kind: "catalog" }
  | { readonly kind: "view"; readonly target: Target; readonly viewKey: string }
  | { readonly kind: "missing" };

/** Resolve saved view identities from before views contributed individual tabs. */
export function canonicalViewKey(key: string): string {
  const view =
    key === "dag/graph"
      ? "graph-explainer/graph"
      : key === "editor/notebook"
        ? "notebook/notebook"
        : key;
  return view.split("/").length === 2 ? `${view}/main` : view;
}

/** Builds a bookmarkable URL for one notebook and registered view. */
export function viewHref(target: Target, viewKey: string): string {
  const query = new URLSearchParams({ host: target.connectionId, view: viewKey });
  return `/notebook/${encodeURIComponent(target.notebookId)}?${query}`;
}

/** Reads the page identity without carrying session credentials in the URL. */
export function parseRoute(url: URL): Route {
  if (url.pathname === "/") return { kind: "catalog" };
  const match = /^\/notebook\/([^/]+)$/.exec(url.pathname);
  const connectionId = url.searchParams.get("host");
  const viewKey = url.searchParams.get("view");
  if (!match || !connectionId || !viewKey) return { kind: "missing" };
  try {
    return {
      kind: "view",
      target: { connectionId, notebookId: decodeURIComponent(match[1]) },
      viewKey: canonicalViewKey(viewKey),
    };
  } catch {
    return { kind: "missing" };
  }
}
