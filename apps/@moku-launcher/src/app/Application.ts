/**
 * Compose the shared workspace, plugins, and notebooks for a launcher application.
 *
 * @module
 */
import { Data, Effect } from "effect";
import { Atom } from "effect/reactivity";
import * as Workspace from "./Workspace.ts";
import type * as Notebook from "./Notebook.ts";
import { Plugin } from "@moku/plugin";

class Target extends Data.Class<Notebook.Target> {}

/** Creates application state for views that share an atom registry. */
export function make(options: {
  launchKey?: string;
  plugins: readonly Plugin.Interface[];
  fetch?: typeof globalThis.fetch;
}) {
  const workspace = Atom.make(Workspace.make(options)).pipe(Atom.setIdleTTL(0));
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
