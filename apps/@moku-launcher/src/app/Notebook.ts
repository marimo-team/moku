import type * as Host from "@moku/core/Host";
import type * as Model from "@moku/core/Notebook";
/** Compose a notebook model with launcher identity and output assets. @module */
import { Effect } from "effect";

/** A notebook selected through a launcher host connection. */
export interface Target {
  readonly connectionId: string;
  readonly notebookId: string;
}

/** The complete notebook supplied to launcher views. */
export interface Interface extends Model.Interface {
  readonly target: Target;
  /** Resolves output assets for the renderer. */
  readonly assetUrl: (path: string) => string;
}

/** Attach a notebook and resolve its output assets against its marimo server. */
export const make = Effect.fnUntraced(function* (
  host: Host.Interface,
  input: Target,
  baseUrl: URL,
) {
  const target = Object.freeze({ ...input });
  const notebook = yield* host.notebooks.attach(target.notebookId);
  return {
    ...notebook,
    target,
    assetUrl: (path: string) => {
      if (!/^(\.\/|\/)@file\//.test(path))
        throw new Error("Expected a marimo @file asset path.");
      const base = baseUrl.pathname.replace(/\/$/, "");
      const url = new URL(base + path.replace(/^\./, ""), baseUrl);
      if (url.origin !== baseUrl.origin || !url.pathname.startsWith(base + "/@file/"))
        throw new Error("Invalid asset path.");
      return url.href;
    },
  } satisfies Interface;
});
