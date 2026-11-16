import * as Vitest from "vite-plus/test";
import { Schema } from "effect";
import * as Protocol from "@moku/core/Protocol";
import * as Chart from "../../src/plugins/sheet/chart.ts";
import * as Layout from "../../src/plugins/sheet/layout.ts";
import type * as Values from "../../src/plugins/sheet/values.ts";

type Document = Parameters<typeof Layout.of>[0];

function sheet(cells: Record<string, string | number>) {
  const entries = Object.entries(cells).map(([name, value]) => ({
    id: Schema.decodeUnknownSync(Protocol.CellId)(`id-${name}`),
    name,
    code: `${name} = ${JSON.stringify(value)}`,
    config: { column: null, disabled: false, hide_code: false, expand_output: false },
  }));
  const document: Document = {
    order: entries.map((entry) => entry.id),
    cells: new Map(entries.map((entry) => [entry.id, entry])),
  };
  const values: Values.Selection = {
    // SAFETY: drafting a chart reads only the displays below.
    // @ts-expect-error The fixture omits the output selection.
    outputs: undefined,
    cells: new Map(
      Object.entries(cells).map(([name, value]) => [
        `id-${name}`,
        {
          display: {
            kind: "value",
            text: String(value),
            numeric: typeof value === "number",
          },
          busy: false,
          executionId: null,
        },
      ]),
    ),
  };
  return { layout: Layout.of(document), values };
}

Vitest.test("pins cells named chart_ and an address over the grid", () => {
  const { layout } = sheet({ A1: 1, chart_C2: 0, chart_C2_2: 0, chart: 0 });
  Vitest.expect(layout.charts.map((chart) => [chart.cell.name, chart.anchor])).toEqual([
    ["chart_C2", { col: 2, row: 1 }],
    ["chart_C2_2", { col: 2, row: 1 }],
  ]);
  Vitest.expect(layout.others.map((cell) => cell.name)).toEqual(["chart"]);
  Vitest.expect(Layout.chartName({ col: 2, row: 1 }, new Set(["chart_C2"]))).toBe(
    "chart_C2_2",
  );
});

Vitest.test("charts the selected column with its labels and title", () => {
  const { layout, values } = sheet({
    B1: "Revenue",
    A2: "Jan",
    B2: 10,
    A3: "Feb",
    B3: 12,
    A4: "Mar",
    B4: 9,
  });
  Vitest.expect(Chart.draft(layout, values, { col: 1, row: 2 })).toEqual({
    anchor: { col: 3, row: 1 },
    code: [
      "_fig, _ax = plt.subplots()",
      '_ax.plot([A2, A3, A4], [B2, B3, B4], marker="o")',
      '_ax.set_title("Revenue")',
      "_fig",
    ].join("\n"),
  });
});

Vitest.test("drafts placeholder data away from numbers", () => {
  const { layout, values } = sheet({ A1: "Notes" });
  Vitest.expect(Chart.draft(layout, values, { col: 0, row: 0 }).code).toContain(
    "_ax.plot([1, 3, 2, 4]",
  );
});

Vitest.test("ends the data before a total and finds labels further left", () => {
  const { layout, values } = sheet({
    A2: "Jan",
    B2: 10,
    C2: 4,
    A3: "Feb",
    B3: 12,
    C3: 5,
    A4: "Total",
    B4: 22,
    C4: 9,
  });
  // The fixture's codes are literals, so give the total a formula reading the column.
  const total = layout.cells.get("C4");
  if (total) Object.assign(total, { code: "C4 = sum([C2, C3])\nC4" });
  Vitest.expect(Chart.draft(layout, values, { col: 2, row: 1 }).code).toContain(
    '_ax.plot([A2, A3], [C2, C3], marker="o")',
  );
});
