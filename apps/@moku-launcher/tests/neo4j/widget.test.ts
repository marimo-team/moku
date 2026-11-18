// @vitest-environment happy-dom
import * as Vitest from "vite-plus/test";
import * as Result from "../../src/plugins/neo4j/widget/result.ts";
import * as Tables from "../../src/plugins/neo4j/widget/tables.ts";
import * as WidgetCell from "../../src/plugins/neo4j/widgetCell.ts";

// As CypherGraph.serialize returns for `MATCH p=(a)-[r:ACTED_IN]->(m) RETURN p, a, r, m, 0.0/0.0`.
const paths: Result.Result = {
  nodes: [
    {
      id: "4:x:0",
      labels: ["Person"],
      properties: { born: 1964, name: "Keanu Reeves" },
    },
    {
      id: "4:x:1",
      labels: ["Movie"],
      properties: { title: "The Matrix", released: 1999 },
    },
  ],
  relationships: [
    {
      id: "5:x:0",
      type: "ACTED_IN",
      start: "4:x:0",
      end: "4:x:1",
      properties: { roles: ["Neo"] },
    },
  ],
  keys: ["p", "a", "r", "m", "nan"],
  records: [
    [
      { $path: ["4:x:0", "4:x:1"] },
      { $node: "4:x:0" },
      { $relationship: "5:x:0" },
      { $node: "4:x:1" },
      "nan",
    ],
  ],
  truncated: false,
  limit: 2000,
};

Vitest.describe("widget cell", () => {
  Vitest.test("names its version on the first line", () => {
    Vitest.expect(WidgetCell.versionOf(WidgetCell.source)).toBe(WidgetCell.version);
    Vitest.expect(WidgetCell.isCurrent(WidgetCell.source)).toBe(true);
  });

  Vitest.test("inlines the bundle and styles into the Python class", () => {
    Vitest.expect(WidgetCell.source).toContain(
      "class CypherGraph(anywidget.AnyWidget):",
    );
    Vitest.expect(WidgetCell.source).not.toContain("__MOKU_");
    Vitest.expect(WidgetCell.source).toMatch(/_esm = "[^\n]*render/);
  });

  Vitest.test("recognizes only generated cells", () => {
    Vitest.expect(WidgetCell.versionOf("import anywidget")).toBeUndefined();
    const older = WidgetCell.source.replace(WidgetCell.version, "0123456789ab");
    Vitest.expect(WidgetCell.versionOf(older)).toBe("0123456789ab");
    Vitest.expect(WidgetCell.isCurrent(older)).toBe(false);
  });
});

Vitest.describe("result", () => {
  Vitest.test("reads graph references from records", () => {
    Vitest.expect(paths.records[0]!.map(Result.reference)).toEqual([
      { $path: ["4:x:0", "4:x:1"] },
      { $node: "4:x:0" },
      { $relationship: "5:x:0" },
      { $node: "4:x:1" },
      undefined,
    ]);
    Vitest.expect(Result.reference({ $node: "a", other: 1 })).toBeUndefined();
    Vitest.expect(Result.reference({ $path: [1] })).toBeUndefined();
  });

  Vitest.test("captions nodes and formats values", () => {
    Vitest.expect(paths.nodes.map(Result.caption)).toEqual([
      "Keanu Reeves",
      "The Matrix",
    ]);
    Vitest.expect(Result.labelOrder(paths.nodes)).toEqual(["Person", "Movie"]);
    Vitest.expect(Result.formatValue({ roles: ["Neo"], n: null })).toBe(
      '{roles: ["Neo"], n: null}',
    );
  });
});

Vitest.describe("tables", () => {
  Vitest.test("draws records with graph references resolved", () => {
    const table = Tables.draw("records", paths, undefined, () => {});
    const cells = [...table.querySelectorAll("tbody td")].map(
      (cell) => cell.textContent,
    );
    Vitest.expect(cells).toEqual([
      "Keanu Reeves→The Matrix",
      "Keanu Reeves",
      ":ACTED_IN",
      "The Matrix",
      "nan",
    ]);
  });

  Vitest.test("keeps column headers when a query returns no rows", () => {
    const table = Tables.draw(
      "records",
      { ...paths, records: [] },
      undefined,
      () => {},
    );
    Vitest.expect(
      [...table.querySelectorAll("th")].map((th) => th.textContent),
    ).toEqual(paths.keys);
    Vitest.expect(table.textContent).toContain("The query returned no records.");
  });

  Vitest.test("toggles node selection on click", () => {
    const selected: (string | undefined)[] = [];
    const table = Tables.draw("nodes", paths, "4:x:1", (id) => selected.push(id));
    const rows = table.querySelectorAll<HTMLElement>("tbody tr");
    rows[0]!.click();
    rows[1]!.click();
    Vitest.expect(selected).toEqual(["4:x:0", undefined]);
  });
});
