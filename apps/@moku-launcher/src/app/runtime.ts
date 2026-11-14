/** Share workspace, plugin, and notebook atoms across launcher views. @module */
import { Data, Effect } from "effect";
import { Atom } from "effect/reactivity";
import * as Proxy from "./Proxy.ts";
import * as Workspace from "./Workspace.ts";
import * as Notebook from "./Notebook.ts";
import { Plugin } from "@moku/plugin";
import * as Host from "./views.ts";

class Target extends Data.Class<Notebook.Target> {}

/** Creates the atoms used by launcher views in their shared registry. */
export function make(options: {
  baseUrl: string | URL;
  launchKey?: string;
  plugins: readonly Plugin.Interface[];
  fetch?: typeof globalThis.fetch;
}) {
  const proxy = Proxy.make(options.baseUrl, { fetch: options.fetch });
  const runtime = Atom.runtime(proxy.http);
  const notebooks = Atom.family((target: Target) =>
    runtime.atom(Notebook.make(proxy, target)).pipe(Atom.setIdleTTL(0)),
  );
  return {
    workspace: runtime
      .atom(Workspace.make(proxy, { launchKey: options.launchKey }))
      .pipe(Atom.setIdleTTL(0)),
    host: runtime
      .atom(Plugin.load(options.plugins).pipe(Effect.map(Host.make)))
      .pipe(Atom.setIdleTTL(0)),
    notebook: (target: Notebook.Target) => notebooks(new Target(target)),
  };
}
/** Workspace, plugin, and notebook atoms for a launcher instance. */
export type Interface = ReturnType<typeof make>;
