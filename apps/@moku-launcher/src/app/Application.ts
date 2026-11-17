/**
 * Compose the shared workspace, plugins, and notebooks for a launcher application.
 *
 * @module
 */
import { Data, Effect } from "effect";
import { Atom } from "effect/reactivity";
import * as Proxy from "./Proxy.ts";
import * as Workspace from "./Workspace.ts";
import * as Notebook from "./Notebook.ts";
import { Plugin } from "@moku/plugin";

class Target extends Data.Class<Notebook.Target> {}

/** Creates application state for views that share an atom registry. */
export function make(options: {
  baseUrl: string | URL;
  launchKey?: string;
  plugins: readonly Plugin.Interface[];
  fetch?: typeof globalThis.fetch;
}) {
  const proxy = Proxy.make(options.baseUrl, { fetch: options.fetch });
  const runtime = Atom.runtime(proxy.http);
  const workspace = runtime
    .atom(Workspace.make({ launchKey: options.launchKey, marimo: proxy.marimo }))
    .pipe(Atom.setIdleTTL(0));
  const notebooks = Atom.family((target: Target) =>
    runtime
      .atom((get) =>
        Effect.gen(function* () {
          const session = yield* get.result(workspace);
          const host = yield* session.host(target.connectionId);
          return yield* Notebook.make(proxy, host, target);
        }),
      )
      .pipe(Atom.setIdleTTL(0)),
  );
  return {
    workspace,
    plugins: runtime.atom(Plugin.load(options.plugins)).pipe(Atom.setIdleTTL(0)),
    notebook: (target: Notebook.Target) => notebooks(new Target(target)),
  };
}
/** Shared state and notebook access for one launcher application. */
export type Interface = ReturnType<typeof make>;
