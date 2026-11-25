import * as Vitest from "vite-plus/test";
import {
  freshName,
  helperOf,
  ownersOf,
  reconcile,
  staleCode,
} from "../../src/plugins/drawing/reconcile.ts";
import { card, cells, link } from "./fixtures.ts";

Vitest.test("a new card creates and runs its cell", () => {
  const slider = card("slider");
  Vitest.expect(reconcile(ownersOf([]), ownersOf([slider]), cells({}))).toEqual({
    ops: [{ kind: "create", name: "slider", code: "slider = 1" }],
    run: ["slider"],
    renames: [],
  });
});

Vitest.test("moving or resizing a card leaves the notebook alone", () => {
  const before = card("slider");
  const after = { ...before, origin: { x: 50, y: 50 }, scale: 2 };
  const plan = reconcile(
    ownersOf([before]),
    ownersOf([after]),
    cells({ slider: "slider = 1" }),
  );
  Vitest.expect(plan).toEqual({ ops: [], run: [], renames: [] });
});

Vitest.test(
  "a refine (new ask) rewrites and reruns the cell; undoing it does too",
  () => {
    const before = card("plot", "plot = 1", "a1");
    const after = { ...before, data: { code: "plot = 2", askId: "a2" } };
    const forward = reconcile(
      ownersOf([before]),
      ownersOf([after]),
      cells({ plot: "plot = 1" }),
    );
    Vitest.expect(forward.ops).toEqual([
      { kind: "update", name: "plot", code: "plot = 2" },
    ]);
    Vitest.expect(forward.run).toEqual(["plot"]);
    const back = reconcile(
      ownersOf([after]),
      ownersOf([before]),
      cells({ plot: "plot = 2" }),
    );
    Vitest.expect(back.ops).toEqual([
      { kind: "update", name: "plot", code: "plot = 1" },
    ]);
  },
);

Vitest.test("removing the last card for a cell deletes it; undo brings it back", () => {
  const slider = card("slider");
  Vitest.expect(
    reconcile(ownersOf([slider]), ownersOf([]), cells({ slider: "slider = 1" })).ops,
  ).toEqual([{ kind: "delete", name: "slider" }]);
  Vitest.expect(reconcile(ownersOf([]), ownersOf([slider]), cells({})).ops).toEqual([
    { kind: "create", name: "slider", code: "slider = 1" },
  ]);
});

Vitest.test("a pasted copy gets a cell of its own", () => {
  const original = card("slider");
  const copy = { ...card("slider"), id: "COPY" };
  const plan = reconcile(
    ownersOf([original]),
    ownersOf([original, copy]),
    cells({ slider: "slider = 1" }),
  );
  Vitest.expect(plan.renames).toEqual([{ id: "COPY", ref: "slider_2" }]);
  Vitest.expect(plan.ops).toEqual([
    { kind: "create", name: "slider_2", code: "slider = 1" },
  ]);
  // Once renamed, nothing more happens, and the original's cell stays.
  const renamed = { ...copy, ref: "slider_2" };
  const after = reconcile(
    ownersOf([original, copy]),
    ownersOf([original, renamed]),
    cells({ slider: "slider = 1", slider_2: "slider = 1" }),
  );
  Vitest.expect(after.ops).toEqual([]);
});

Vitest.test(
  "a cell deleted elsewhere is not recreated behind the person's back",
  () => {
    const slider = card("slider");
    const moved = { ...slider, origin: { x: 9, y: 9 } };
    Vitest.expect(
      reconcile(ownersOf([slider]), ownersOf([moved]), cells({})).ops,
    ).toEqual([]);
  },
);

Vitest.test("edits made in other views flow back into the cards", () => {
  const slider = card("slider", "slider = 1");
  Vitest.expect(staleCode(ownersOf([slider]), cells({ slider: "slider = 2" }))).toEqual(
    [{ id: slider.id, code: "slider = 2" }],
  );
  Vitest.expect(staleCode(ownersOf([slider]), cells({ slider: "slider = 1" }))).toEqual(
    [],
  );
  Vitest.expect(staleCode(ownersOf([slider]), cells({ slider: null }))).toEqual([]);
});

Vitest.test("fresh names count up", () => {
  const taken = new Set(["plot", "plot_2"]);
  Vitest.expect(freshName("plot", (n) => taken.has(n))).toBe("plot_3");
  Vitest.expect(freshName("chart", (n) => taken.has(n))).toBe("chart");
});

Vitest.test(
  "a link's helper cells come and go with it, and a re-ask rewrites them",
  () => {
    const slider = card("slider");
    const chart = card("chart");
    const linked = link(
      slider,
      chart,
      [{ name: "samples", code: "samples = draw()" }],
      "c1",
    );
    const before = ownersOf([slider, chart]);
    const after = ownersOf([slider, chart], [linked]);
    const existing = cells({ slider: "slider = 1", chart: "chart = 1" });
    Vitest.expect(reconcile(before, after, existing)).toEqual({
      ops: [{ kind: "create", name: "samples", code: "samples = draw()" }],
      run: ["samples"],
      renames: [],
    });
    const withHelper = cells({
      slider: "slider = 1",
      chart: "chart = 1",
      samples: "samples = draw()",
    });
    // Undoing the connection (or deleting the link) deletes it.
    Vitest.expect(reconcile(after, before, withHelper).ops).toEqual([
      { kind: "delete", name: "samples" },
    ]);
    // Asking again rewrites it; a helper the new answer doesn't keep goes.
    const reasked = link(
      slider,
      chart,
      [{ name: "noise", code: "noise = 1" }],
      "c2",
      linked.id,
    );
    Vitest.expect(
      reconcile(after, ownersOf([slider, chart], [reasked]), withHelper).ops,
    ).toEqual([
      { kind: "create", name: "noise", code: "noise = 1" },
      { kind: "delete", name: "samples" },
    ]);
    const rewritten = link(
      slider,
      chart,
      [{ name: "samples", code: "samples = draw(2)" }],
      "c3",
      linked.id,
    );
    Vitest.expect(
      reconcile(after, ownersOf([slider, chart], [rewritten]), withHelper).ops,
    ).toEqual([{ kind: "update", name: "samples", code: "samples = draw(2)" }]);
    Vitest.expect(helperOf(after[2].id)).toEqual({ link: linked.id, name: "samples" });
    Vitest.expect(helperOf(slider.id)).toBeNull();
    // Edits to a helper in another view flow back into the link.
    Vitest.expect(
      staleCode(
        after,
        cells({ slider: "slider = 1", chart: "chart = 1", samples: "samples = 2" }),
      ),
    ).toEqual([{ id: after[2].id, code: "samples = 2" }]);
  },
);
