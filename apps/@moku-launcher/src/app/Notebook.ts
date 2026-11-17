/** Compose a notebook model with launcher identity and output assets. @module */
import { Effect } from "effect";
import type * as Model from "@moku/core/Notebook";
import type * as Host from "@moku/core/Host";

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

/** Attach a notebook and resolve its output assets through the launcher proxy. */
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
      const url = new URL(baseUrl.pathname + path.replace(/^\./, ""), baseUrl);
      if (!url.pathname.startsWith(baseUrl.pathname + "/@file/"))
        throw new Error("Invalid asset path.");
      return url.href;
    },
  } satisfies Interface;
});
