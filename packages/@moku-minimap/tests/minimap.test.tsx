// @vitest-environment happy-dom
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import * as Notebook from "@moku/core/Notebook";
import * as Protocol from "@moku/core/Protocol";
import * as Minimap from "../src/index.ts";
import { fixture } from "./fixture.ts";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

async function mount(
  initial = fixture(),
  label: (cell: Minimap.Cell) => React.ReactNode = (cell) =>
    cell.definitions.join(", ") || cell.code,
  copies = 1,
) {
  const registry = AtomRegistry.make();
  const state = Atom.make<Notebook.State>({
    value: initial,
    status: "connected",
    error: null,
    source: { document: null, canEdit: false },
  });
  const notebook = { state };
  const element = document.createElement("div");
  document.body.append(element);
  const root = ReactDOMClient.createRoot(element);
  Vitest.onTestFinished(async () => {
    await React.act(async () => root.unmount());
    registry.dispose();
    element.remove();
  });
  await React.act(async () =>
    root.render(
      <RegistryContext.Provider value={registry}>
        {Array.from({ length: copies }, (_, index) => (
          <Minimap.Minimap key={index} notebook={notebook}>
            <Minimap.List>{label}</Minimap.List>
            <Minimap.Selection>
              {(selection, unselect) => (
                <div className="moku-minimap-summary">
                  {selection.graph.current
                    ? `${selection.upstream.size} upstream · ${selection.downstream.size} downstream`
                    : "Dependencies unavailable"}
                  <button onClick={unselect}>Unselect</button>
                </div>
              )}
            </Minimap.Selection>
          </Minimap.Minimap>
        ))}
      </RegistryContext.Provider>,
    ),
  );
  return {
    element,
    rows: () => [...element.querySelectorAll<HTMLButtonElement>(".moku-minimap-row")],
    update: async (value: Notebook.Snapshot) => {
      await React.act(async () =>
        registry.update(state, (previous) => ({ ...previous, value })),
      );
    },
  };
}

Vitest.test(
  "selection traces relationships, toggles, clears with Escape, and does not revive after deletion",
  async () => {
    const initial = fixture();
    const view = await mount(initial);
    const clickSource = () => React.act(async () => view.rows()[1].click());
    await clickSource();
    Vitest.expect(view.rows()[1].getAttribute("aria-pressed")).toBe("true");
    Vitest.expect(view.rows()[0].dataset.relation).toBe("downstream");
    Vitest.expect(view.rows()[0].dataset.direct).toBe("false");
    Vitest.expect(view.rows()[2].dataset.direct).toBe("true");
    Vitest.expect(
      view.element.querySelectorAll(".moku-minimap-paths path"),
    ).toHaveLength(1);
    Vitest.expect(view.element.textContent).toContain("0 upstream · 2 downstream");
    await clickSource();
    Vitest.expect(view.element.querySelector('[aria-pressed="true"]')).toBeNull();
    await clickSource();
    await React.act(async () =>
      view
        .rows()[1]
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    Vitest.expect(view.element.querySelector('[aria-pressed="true"]')).toBeNull();
    await clickSource();
    const unselect = view.element.querySelector<HTMLButtonElement>(
      ".moku-minimap-summary button",
    );
    Vitest.expect(unselect?.textContent).toBe("Unselect");
    await React.act(async () => unselect?.click());
    Vitest.expect(view.element.querySelector('[aria-pressed="true"]')).toBeNull();
    Vitest.expect(view.element.querySelector(".moku-minimap-summary")).toBeNull();
    await clickSource();
    await view.update({
      ...initial,
      document: { ...initial.document, order: ["result", "middle", "isolated"] },
    });
    await view.update(initial);
    Vitest.expect(view.element.querySelector('[aria-pressed="true"]')).toBeNull();
  },
);

Vitest.test(
  "stale analysis removes selected connections without hiding rows",
  async () => {
    const initial = fixture();
    const view = await mount(initial);
    await React.act(async () => view.rows()[1].click());
    await view.update({ ...initial, document: { ...initial.document, etag: "v2" } });
    Vitest.expect(view.rows()).toHaveLength(4);
    Vitest.expect(view.element.textContent).toContain("Dependencies unavailable");
    Vitest.expect(
      view.element.querySelectorAll(".moku-minimap-paths path"),
    ).toHaveLength(0);
    Vitest.expect(view.rows()[1].textContent).toContain("source = 1");
  },
);

Vitest.test(
  "shifted endpoints do not retain overview arms beyond their connections",
  async () => {
    const view = await mount();
    const middle = () => view.element.querySelector('[data-cell-id="middle"]');
    Vitest.expect(middle()?.querySelectorAll("path")).toHaveLength(2);

    await React.act(async () => view.rows()[1].click());
    Vitest.expect(middle()?.getAttribute("data-relation")).toBe("downstream");
    Vitest.expect(middle()?.querySelectorAll("path")).toHaveLength(0);
    Vitest.expect(
      view.element.querySelectorAll(".moku-minimap-paths path"),
    ).toHaveLength(1);
    Vitest.expect(
      view.element.querySelector('[data-cell-id="result"] path')?.getAttribute("d"),
    ).toBe("M -8 0 H 0");

    await React.act(async () => view.rows()[0].click());
    Vitest.expect(middle()?.getAttribute("data-relation")).toBe("upstream");
    Vitest.expect(middle()?.querySelectorAll("path")).toHaveLength(0);
    Vitest.expect(
      view.element.querySelector('[data-cell-id="source"] path')?.getAttribute("d"),
    ).toBe("M 0 0 H 8");
  },
);

Vitest.test(
  "active work supersedes old errors and prior runtimes do not supply status",
  async () => {
    const initial = fixture();
    initial.runtime = Protocol.Runtime.parse({
      id: "rt",
      notebook_id: "n",
      status: "running",
      started_at: "2026-11-13T12:00:00Z",
      marimo_version: null,
      message: null,
    });
    const failed = Protocol.Execution.parse({
      id: "failed",
      cell_id: "source",
      runtime_id: "rt",
      run_id: "r",
      caused_by: null,
      code: null,
      code_fingerprint: "source",
      depends_on: {},
      status: "completed",
      started_at: "2026-11-13T12:00:00Z",
      completed_at: "2026-11-13T12:00:01Z",
      outcome: {
        kind: "error",
        error: {
          kind: "exception",
          name: "ValueError",
          message: "bad input",
          source: "marimo",
          severity: "error",
          range: null,
          related: [],
          traceback: null,
        },
      },
    });
    initial.executions = { failed };
    const label = vi.fn(
      (cell: Minimap.Cell) => cell.definitions.join(", ") || cell.code,
    );
    const view = await mount(initial, label);
    label.mockClear();
    Vitest.expect(view.rows()[1].getAttribute("aria-label")).toContain("bad input");
    await view.update({
      ...initial,
      executions: {
        queued: {
          ...failed,
          id: "queued",
          status: "queued",
          outcome: null,
          started_at: null,
          completed_at: null,
        },
        failed,
      },
    });
    Vitest.expect(label.mock.calls.map(([cell]) => cell.id)).toEqual(["source"]);
    Vitest.expect(view.rows()[1].getAttribute("aria-label")).toContain("Queued");
    Vitest.expect(view.rows()[1].getAttribute("aria-label")).not.toContain("bad input");
    label.mockClear();
    await view.update({
      ...initial,
      runtime: { ...initial.runtime, id: "replacement" },
    });
    Vitest.expect(view.rows()[1].getAttribute("aria-label")).not.toContain("bad input");
    Vitest.expect(label.mock.calls.map(([cell]) => cell.id)).toEqual(["source"]);
  },
);

Vitest.test(
  "an analysis error renders only its row and updates its glyph",
  async () => {
    const initial = fixture();
    const label = vi.fn(
      (cell: Minimap.Cell) => cell.definitions.join(", ") || cell.code,
    );
    const view = await mount(initial, label);
    await React.act(async () => view.rows()[1].click());
    label.mockClear();
    await view.update({
      ...initial,
      analysis: Protocol.Analysis.parse({
        ...initial.analysis,
        cells: {
          ...initial.analysis.cells,
          source: {
            ...initial.analysis.cells.source,
            errors: [
              {
                kind: "exception",
                name: "ValueError",
                message: "bad input",
                source: "marimo",
                severity: "error",
                range: null,
                related: [],
                traceback: null,
              },
            ],
          },
        },
      }),
    });
    Vitest.expect(label.mock.calls.map(([cell]) => cell.id)).toEqual(["source"]);
    Vitest.expect(view.rows()[1].getAttribute("aria-label")).toContain("bad input");
    Vitest.expect(
      view.element.querySelector('[data-cell-id="source"]')?.getAttribute("data-error"),
    ).toBe("true");
    Vitest.expect(
      view.element.querySelector(".moku-minimap-paths")?.getAttribute("data-error"),
    ).toBe("true");
  },
);

Vitest.test(
  "appending an isolated cell preserves existing rows; new edges update affected rows",
  async () => {
    const initial = fixture();
    const label = vi.fn(
      (cell: Minimap.Cell) => cell.definitions.join(", ") || cell.code,
    );
    const view = await mount(initial, label);
    await React.act(async () => view.rows()[1].click());
    const existing = view.rows();
    label.mockClear();
    const added = {
      ...initial,
      cells: { ...initial.cells, added: { ...initial.cells.isolated, id: "added" } },
      document: {
        ...initial.document,
        order: [...initial.document.order, "added"],
        etag: "v2",
      },
      analysis: { ...initial.analysis, document_etag: "v2" },
    };
    await view.update(added);
    Vitest.expect(label.mock.calls.map(([cell]) => [cell.id, cell.relation])).toEqual([
      ["added", "unrelated"],
    ]);
    Vitest.expect(view.rows().slice(0, 4)).toEqual(existing);
    label.mockClear();
    await view.update({
      ...added,
      analysis: {
        ...added.analysis,
        cells: {
          ...added.analysis.cells,
          added: { defs: [], refs: ["x"], errors: [] },
        },
      },
    });
    Vitest.expect(label.mock.calls.map(([cell]) => cell.id)).toEqual(["added"]);
    Vitest.expect(view.rows()[4].dataset.relation).toBe("downstream");
    Vitest.expect(view.rows()[4].dataset.direct).toBe("true");
    Vitest.expect(view.element.textContent).toContain("0 upstream · 3 downstream");
  },
);

Vitest.test("two minimaps using one notebook keep independent selections", async () => {
  const view = await mount(fixture(), undefined, 2);
  const [first, second] = view.element.querySelectorAll("section");
  const firstRows = first.querySelectorAll<HTMLButtonElement>(".moku-minimap-row");
  const secondRows = second.querySelectorAll<HTMLButtonElement>(".moku-minimap-row");
  await React.act(async () => firstRows[1].click());
  Vitest.expect(second.querySelector('[aria-pressed="true"]')).toBeNull();
  await React.act(async () => secondRows[0].click());
  Vitest.expect(firstRows[1].getAttribute("aria-pressed")).toBe("true");
  Vitest.expect(secondRows[0].getAttribute("aria-pressed")).toBe("true");
});
