import { Data } from "effect";
import { Atom } from "effect/reactivity";
import * as Model from "@moku/core";
import * as Workspace from "@moku/core/Workspace";
import * as Notebook from "@moku/core/Notebook";
import { Plugin } from "@moku/plugin";

class Target extends Data.Class<Notebook.Target> {}

export function makeRuntime(options: {
  baseUrl: string | URL;
  launchKey?: string;
  plugins: readonly Plugin.Interface[];
  fetch?: typeof globalThis.fetch;
}) {
  const runtime = Atom.runtime(Model.layer(options.baseUrl, { fetch: options.fetch }));
  const notebooks = Atom.family((target: Target) =>
    runtime.atom(Notebook.make(target)).pipe(Atom.setIdleTTL(0)),
  );
  return {
    workspace: runtime
      .atom(Workspace.make({ launchKey: options.launchKey }))
      .pipe(Atom.setIdleTTL(0)),
    plugins: runtime.atom(Plugin.load(options.plugins)).pipe(Atom.setIdleTTL(0)),
    notebook: (target: Notebook.Target) => notebooks(new Target(target)),
  };
}
export type Runtime = ReturnType<typeof makeRuntime>;
