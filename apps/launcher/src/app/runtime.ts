import { Data } from "effect";
import { Atom } from "effect/reactivity";
import * as Model from "@momo/model";
import * as Workspace from "@momo/model/Workspace";
import * as Notebook from "@momo/model/Notebook";
import type { Plugin } from "@momo/plugin";
import * as Host from "./Host.ts";

class Target extends Data.Class<Notebook.Target> {}

export function makeRuntime(options: {
  baseUrl: string | URL;
  launchKey?: string;
  plugins: readonly Plugin.Plugin[];
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
    host: runtime.atom(Host.make(options.plugins)).pipe(Atom.setIdleTTL(0)),
    notebook: (target: Notebook.Target) => notebooks(new Target(target)),
  };
}
export type Runtime = ReturnType<typeof makeRuntime>;
