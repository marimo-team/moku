import { Schema } from "effect";
import * as Vitest from "vite-plus/test";
import * as Protocol from "@moku/core/Protocol";
import { emptyState } from "../../../../packages/@moku-core/tests/fixtures.ts";
import * as Outputs from "../../src/plugins/notebook/outputs.ts";

function fixture() {
  const cell = Schema.decodeUnknownSync(Protocol.Cell)({
    id: "c",
    notebook_id: "n",
    code: "await asyncio.sleep(3)",
    name: "work",
    config: {
      column: null,
      disabled: false,
      hide_code: false,
      expand_output: false,
    },
    etag: "v1",
    code_fingerprint: "v1",
    version: 1,
  });
  const old = Schema.decodeUnknownSync(Protocol.Execution)({
    id: "old",
    run_id: "previous",
    runtime_id: "rt",
    caused_by: null,
    cell_id: "c",
    code: null,
    code_fingerprint: "v1",
    depends_on: {},
    status: "completed",
    started_at: "2026-11-12T12:00:00Z",
    completed_at: "2026-11-12T12:00:03Z",
    outcome: { kind: "value", display: null },
  });
  const pending = Schema.decodeUnknownSync(Protocol.Execution)({
    ...old,
    id: "pending",
    run_id: "next",
    status: "queued",
    started_at: null,
    completed_at: null,
    outcome: null,
  });
  const executions: Record<string, typeof Protocol.Execution.Type> = { old, pending };
  const state = {
    ...emptyState(),
    executions,
    document: {
      ...Schema.decodeUnknownSync(Protocol.Document)({
        notebook_id: "n",
        order: ["c"],
        app_config: {},
        etag: "v1",
        saved_etag: "v1",
        order_etag: "v1",
        app_config_etag: "v1",
        version: 1,
      }),
      cells: [cell],
    },
  };
  return { state, old, pending };
}

Vitest.test("a rerun is active while queued and retains the previous result", () => {
  const { state, old, pending } = fixture();
  const queued = Outputs.select(state);
  Vitest.expect(queued.current.get("c")).toBe(pending);
  Vitest.expect(queued.results.get("c")).toBe(old);

  const running = Schema.decodeUnknownSync(Protocol.Execution)({
    ...pending,
    status: "running" as const,
    started_at: "2026-11-12T12:01:00Z",
  });
  state.executions.pending = running;
  const active = Outputs.select(state, queued);
  Vitest.expect(active.current.get("c")).toBe(running);
  Vitest.expect(active.results.get("c")).toBe(old);

  const completed = Schema.decodeUnknownSync(Protocol.Execution)({
    ...running,
    status: "completed" as const,
    completed_at: "2026-11-12T12:01:03Z",
    outcome: old.outcome,
  });
  state.executions.pending = completed;
  const done = Outputs.select(state, active);
  Vitest.expect(done.current.get("c")).toBe(completed);
  Vitest.expect(done.results.get("c")).toBe(completed);
});

Vitest.test("snapshot record order does not hide a queued rerun", () => {
  const { state, old, pending } = fixture();
  state.executions = { pending, old };
  Vitest.expect(Outputs.select(state).current.get("c")).toBe(pending);
});

Vitest.test("each cell shows its own outputs and removed displays disappear", () => {
  const { state, old } = fixture();
  const other = Schema.decodeUnknownSync(Protocol.Cell)({
    ...state.document.cells[0],
    id: "other",
  });
  state.document = { ...state.document, cells: [...state.document.cells, other] };
  const execution = Schema.decodeUnknownSync(Protocol.Execution)({
    ...old,
    id: "other",
    cell_id: "other",
  });
  state.executions = { ...state.executions, other: execution };
  const display = Schema.decodeUnknownSync(Protocol.Display)({
    id: "d",
    execution_id: "pending",
    seq: 2,
    content: { mimetype: "text/plain", data: "first" },
  });
  state.displays = { d: display };
  state.consoles = {
    c: Schema.decodeUnknownSync(Protocol.Console)({
      id: "c",
      execution_id: "pending",
      seq: 1,
      name: "stdout",
      text: "one",
    }),
    other: Schema.decodeUnknownSync(Protocol.Console)({
      id: "other",
      execution_id: "other",
      seq: 0,
      name: "stderr",
      text: "two",
    }),
  };
  const selection = Outputs.select(state);
  Vitest.expect(
    Outputs.forCell(state, selection, "c").items.map((item) => item.id),
  ).toEqual(["c", "d"]);
  Vitest.expect(
    Outputs.forCell(state, selection, "other").items.map((item) => item.id),
  ).toEqual(["other"]);

  state.displays = {};
  const next = Outputs.select(state, selection);
  Vitest.expect(Outputs.forCell(state, next, "c").items.map((item) => item.id)).toEqual(
    ["c"],
  );
});
