import { dependencyGraph } from "../../src/plugins/graph-explainer/diagram/dependencies.ts";
import * as NodeAssert from "node:assert/strict";
import { test } from "vite-plus/test";
import * as Protocol from "@moku/core/Protocol";
import {
  cellStatus,
  type NotebookState,
} from "../../src/plugins/graph-explainer/execution.ts";

function example(): NotebookState {
  const cells = Object.fromEntries(
    [
      ["consumer", "y = x + 1"],
      ["source", "x = 1"],
    ].map(([id, code]) => [
      id,
      Protocol.Cell.parse({
        id,
        notebook_id: "n",
        code,
        name: "_",
        config: {
          column: null,
          disabled: false,
          hide_code: false,
          expand_output: false,
        },
        etag: id,
        code_fingerprint: id,
        version: 1,
      }),
    ]),
  );
  return {
    ready: true,
    phase: "live",
    notebook: null,
    runtime: null,
    cells,
    document: Protocol.Document.parse({
      notebook_id: "n",
      order: ["consumer", "source"],
      app_config: {},
      etag: "v1",
      saved_etag: "v1",
      order_etag: "order",
      app_config_etag: "app",
      version: 1,
    }),
    analysis: Protocol.Analysis.parse({
      notebook_id: "n",
      document_etag: "v1",
      cells: {
        source: { defs: ["x"], refs: [], errors: [] },
        consumer: { defs: ["y"], refs: ["x"], errors: [] },
      },
    }),
    runs: {},
    executions: {},
    consoles: {},
    displays: {},
    variables: {},
    inputs: {},
  };
}

test("dependency order follows code, and stale analysis cannot describe an edited document", () => {
  const state = example();
  NodeAssert.deepEqual(dependencyGraph(state), {
    current: true,
    order: ["source", "consumer"],
    edges: [{ from: "source", to: "consumer", names: ["x"] }],
  });
  const edited = { ...state, document: { ...state.document!, etag: "v2" } };
  NodeAssert.deepEqual(dependencyGraph(edited), {
    current: false,
    order: ["consumer", "source"],
    edges: [],
  });
});

test("cycles remain inspectable without losing or duplicating cells", () => {
  const state = example();
  state.analysis!.cells.source.refs = ["y"];
  const graph = dependencyGraph(state);
  NodeAssert.equal(graph.edges.length, 2);
  NodeAssert.deepEqual(new Set(graph.order), new Set(["source", "consumer"]));
});

test("not executed does not mean skipped, and explicit skip is retained", () => {
  const cell = example().cells.consumer;
  NodeAssert.equal(cellStatus(cell, undefined, []), "pending");
  const execution = Protocol.Execution.parse({
    id: "e",
    run_id: "r",
    runtime_id: "rt",
    caused_by: null,
    cell_id: cell.id,
    code: null,
    code_fingerprint: cell.code_fingerprint,
    depends_on: {},
    status: "completed",
    started_at: null,
    completed_at: "2026-11-05T12:00:00Z",
    outcome: {
      kind: "skipped",
      reason: "ancestor-raised",
      message: "Source failed",
      related: [],
    },
  });
  NodeAssert.equal(cellStatus(cell, execution, []), "skipped");
});
