import * as Vitest from "vite-plus/test";
import type * as Notebook from "@moku/core/Notebook";
import { emptyState } from "../../../../packages/@moku-core/tests/fixtures.ts";
import * as Values from "../../src/plugins/sheet/values.ts";

const placed = new Map([["c1", { name: "A1", code: "A1 = B1 * 2\nA1" }]]);

function execution(id: string, outcome: unknown) {
  return {
    id,
    run_id: "r1",
    runtime_id: "rt",
    cell_id: "c1",
    code_fingerprint: "f1",
    caused_by_id: null,
    created_at: "2026-01-01T00:00:00Z",
    state:
      outcome === null
        ? { status: "running", started_at: "2026-01-01T00:00:00Z", depends_on: {} }
        : {
            status: "completed",
            started_at: "2026-01-01T00:00:00Z",
            completed_at: "2026-01-01T00:00:01Z",
            depends_on: {},
            outcome,
          },
  };
}

/** The rendered output the host publishes for execution `e1`. */
const output = (media: unknown) => ({ o1: { id: "o1", execution_id: "e1", media } });

function state(overrides: Record<string, unknown>): Notebook.State {
  // SAFETY: the selector reads only the fields these fixtures provide, with
  // the shapes the protocol gives them.
  return {
    ...emptyState(),
    runtime: { id: "rt", state: { status: "running" } },
    document: { etag: "d1", cells: [{ id: "c1", code_fingerprint: "f1" }] },
    ...overrides,
  } as unknown as Notebook.State;
}

const value = { kind: "succeeded" };
const variable = (preview: string | null, type: string) => ({
  v1: {
    id: "v1",
    execution_id: "e1",
    name: "A1",
    type,
    preview,
    revision: { execution: "e1", update: 0 },
  },
});

Vitest.test("shows the host's variable for the address", () => {
  const cell = (preview: string | null, type: string) =>
    Values.select(
      state({
        executions: { e1: execution("e1", value) },
        variables: variable(preview, type),
      }),
      placed,
    ).cells.get("c1")?.display;
  Vitest.expect(cell("21", "int")).toEqual({
    kind: "value",
    text: "21",
    numeric: true,
  });
  Vitest.expect(cell("'it\\'s'", "str")).toEqual({
    kind: "value",
    text: "it's",
    numeric: false,
  });
  Vitest.expect(cell("<span>markup</span>", "Html")).toEqual({
    kind: "value",
    text: "Html",
    numeric: false,
  });
});

Vitest.test("keeps showing a widget after its value changes", () => {
  const html = { mimetype: "text/html", data: "<marimo-slider></marimo-slider>" };
  // The host previews a UI element by its current value.
  const slider = Values.select(
    state({
      executions: { e1: execution("e1", value) },
      outputs: output(html),
      variables: variable("0.45", "slider"),
    }),
    placed,
  );
  Vitest.expect(slider.cells.get("c1")?.display).toMatchObject({ kind: "rich" });
});

Vitest.test("renders a plot from the cell's output", () => {
  const png = { mimetype: "image/png", data: "iVBORw0KGgo=" };
  const plot = Values.select(
    state({
      executions: { e1: execution("e1", value) },
      outputs: output(png),
      variables: variable("[<matplotlib.lines.Line2D object at 0x1>]", "list"),
    }),
    placed,
  );
  Vitest.expect(plot.cells.get("c1")?.display).toMatchObject({
    kind: "rich",
    data: png,
  });
});

Vitest.test("renders values without a short text form from the cell's output", () => {
  const html = { mimetype: "text/html", data: "<h2>Total</h2>" };
  const rich = Values.select(
    state({
      executions: { e1: execution("e1", value) },
      outputs: output(html),
      variables: variable("<marimo._output.md._md object>", "_md"),
    }),
    placed,
  );
  Vitest.expect(rich.cells.get("c1")?.display).toEqual({
    kind: "rich",
    data: html,
    runtimeId: "rt",
  });
});

Vitest.test("shows the source before the current runtime evaluates the cell", () => {
  const before = (code: string) =>
    Values.select(state({}), new Map([["c1", { name: "A1", code }]])).cells.get("c1");
  Vitest.expect(before("A1 = B1 * 2\nA1")).toEqual({
    display: { kind: "formula", text: "=B1 * 2" },
    busy: false,
    executionId: null,
  });
  Vitest.expect(before("A1 = 19.5")?.display).toEqual({
    kind: "value",
    text: "19.5",
    numeric: true,
  });
  Vitest.expect(before('A1 = "Price"')?.display).toEqual({
    kind: "value",
    text: "Price",
    numeric: false,
  });
  Vitest.expect(before("import os\nA1 = os.sep")?.display).toEqual({ kind: "blank" });
});

Vitest.test("labels errors the way a spreadsheet does", () => {
  const error = {
    kind: "failed",
    error: {
      kind: "exception",
      name: "ZeroDivisionError",
      message: "division by zero",
    },
  };
  const raised = Values.select(
    state({ executions: { e1: execution("e1", error) } }),
    placed,
  );
  Vitest.expect(raised.cells.get("c1")?.display).toEqual({
    kind: "error",
    label: "#DIV/0!",
    message: "ZeroDivisionError: division by zero",
  });

  const cycle = Values.select(
    state({
      document: { etag: "d1", cells: [{ id: "c1", code_fingerprint: "f1" }] },
      analysis: {
        document_etag: "d1",
        cells: {
          c1: {
            defs: ["A1"],
            refs: ["A1"],
            diagnostics: [
              {
                source: "marimo",
                kind: "cycle-dependencies",
                severity: "error",
                message: "Cycle",
                range: null,
                related: [],
              },
            ],
          },
        },
      },
    }),
    placed,
  );
  Vitest.expect(cycle.cells.get("c1")?.display).toMatchObject({ label: "#CYCLE!" });
});

Vitest.test("keeps the old value while the host evaluates the cell again", () => {
  const before = Values.select(
    state({
      executions: { e1: execution("e1", value) },
      variables: variable("21", "int"),
    }),
    placed,
  );
  // The host removes the previous execution and its variables first.
  const during = Values.select(
    state({ executions: { e2: execution("e2", null) } }),
    placed,
    before,
  );
  Vitest.expect(during.cells.get("c1")).toMatchObject({
    display: { kind: "value", text: "21" },
    busy: true,
  });
});

Vitest.test("shows the new source of a cell edited since it ran", () => {
  const edited = Values.select(
    state({
      document: { etag: "d1", cells: [{ id: "c1", code_fingerprint: "f2" }] },
      executions: { e1: execution("e1", value) },
      variables: variable("21", "int"),
    }),
    placed,
  );
  Vitest.expect(edited.cells.get("c1")?.display).toEqual({
    kind: "formula",
    text: "=B1 * 2",
  });
});
