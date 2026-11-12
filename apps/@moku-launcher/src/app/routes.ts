import type { Target } from "@moku/model/Notebook";

export type Route =
  | { readonly kind: "catalog" }
  | { readonly kind: "view"; readonly target: Target; readonly viewKey: string }
  | { readonly kind: "missing" };

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
      viewKey,
    };
  } catch {
    return { kind: "missing" };
  }
}
