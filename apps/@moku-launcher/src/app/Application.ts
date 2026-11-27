import { Plugin } from "@moku/plugin";
/**
 * Compose the shared workspace, plugins, and notebooks for a launcher application.
 *
 * @module
 */
import { Data, Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { Atom } from "effect/reactivity";

import type * as DirectHost from "./DirectHost.ts";
import type * as Notebook from "./Notebook.ts";
import * as Workspace from "./Workspace.ts";

class Target extends Data.Class<Notebook.Target> {}

/** Supplies the HTTP client used by workspace effects in each atom registry. */
export const runtime = Atom.runtime(FetchHttpClient.layer);

/** Creates application state for views that share an atom registry. */
export function make(options: {
  launchKey?: string;
  directHost?: DirectHost.Input;
  plugins: readonly Plugin.Interface[];
}) {
  const workspace = runtime.atom(Workspace.make(options)).pipe(Atom.setIdleTTL(0));
  const notebooks = Atom.family((target: Target) =>
    Atom.make((get) =>
      get.result(workspace).pipe(Effect.flatMap((session) => session.attach(target))),
    ).pipe(Atom.setIdleTTL(0)),
  );
  return {
    workspace,
    plugins: Atom.make(Plugin.load(options.plugins)).pipe(Atom.setIdleTTL(0)),
    notebook: (target: Notebook.Target) => notebooks(new Target(target)),
  };
}
/** Shared state and notebook access for one launcher application. */
export type Interface = ReturnType<typeof make>;
