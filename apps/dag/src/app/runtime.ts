import { Data } from "effect";
import { Atom } from "effect/reactivity";
import * as Model from "@momo/model";
import * as Workspace from "@momo/model/Workspace";
import * as Notebook from "@momo/model/Notebook";

const launchKey = new URLSearchParams(location.hash.slice(1)).get("key") ?? undefined;
if (launchKey) history.replaceState(null, "", location.pathname + location.search);

const runtime = Atom.runtime(Model.layer(location.origin));
export const workspaceAtom = runtime
  .atom(Workspace.make({ launchKey }))
  .pipe(Atom.setIdleTTL(0));
class Target extends Data.Class<Notebook.Target> {}
const notebooks = Atom.family((target: Target) =>
  runtime.atom(Notebook.attach(target)).pipe(Atom.setIdleTTL(0)),
);
export const notebookAtom = (target: Notebook.Target) => notebooks(new Target(target));
