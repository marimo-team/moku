/** View-owned document, grid layout, displayed values, and commands for one notebook. @module */
import { Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Document from "@moku/editor/Document";
import type * as Notebook from "@moku/core/Notebook";
import { empty } from "../empty.ts";
import * as Actions from "./actions.ts";
import * as Layout from "./layout.ts";
import * as Values from "./values.ts";

function make(notebook: Notebook.Interface) {
  return Effect.gen(function* () {
    const document = yield* Document.make(notebook);
    const layout = Atom.readable((get) => Layout.of(get(document.state).document));
    const values = Atom.readable((get): Values.Selection =>
      Values.select(
        AsyncResult.getOrElse(get(notebook.state), () => empty),
        evaluated(get(layout)),
        Option.getOrUndefined(get.self<Values.Selection>()),
      ),
    );
    const actions = yield* Actions.make(notebook, document);
    return { document, layout, values, ...actions };
  });
}

/** Grid cells and charts, whose displays the view derives, by cell id. */
function evaluated(layout: Layout.Layout): ReadonlyMap<string, Values.Source> {
  const cells = new Map<string, Values.Source>(layout.placed);
  for (const chart of layout.charts) cells.set(chart.cell.id, chart.cell);
  return cells;
}

/** Shares the model while this notebook is mounted in the view. */
export const forNotebook = Atom.family((notebook: Notebook.Interface) =>
  Atom.make(make(notebook)).pipe(Atom.setIdleTTL(0)),
);
export type Interface = Effect.Success<ReturnType<typeof make>>;
