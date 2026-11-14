/**
 * View-owned document and actions for a notebook supplied by the launcher.
 *
 * @module
 */
import * as Observation from "../observation.ts";
import { Effect, Option } from "effect";
import { Atom } from "effect/reactivity";
import * as Document from "@moku/editor/Document";
import type * as Notebook from "@moku/core/Notebook";
import * as Outputs from "./outputs.ts";
import * as Actions from "./actions.ts";

/** Acquires the document and commands for one open Notebook view. */
function make(notebook: Notebook.Interface) {
  return Effect.gen(function* () {
    const document = yield* Document.make(notebook);
    const outputs = Atom.readable((get): Outputs.Selection =>
      Outputs.select(
        Observation.read(get(notebook.state)).value,
        Option.getOrUndefined(get.self<Outputs.Selection>()),
      ),
    );
    const actions = yield* Actions.make(notebook, document);
    return { document, outputs, ...actions };
  });
}

/** Shares the model while this notebook is mounted in the view. */
export const forNotebook = Atom.family((notebook: Notebook.Interface) =>
  Atom.make(make(notebook)).pipe(Atom.setIdleTTL(0)),
);
export type Interface = Effect.Success<ReturnType<typeof make>>;
