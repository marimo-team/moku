import * as Vitest from "vite-plus/test";
import * as Protocol from "@moku/core/Protocol";
import { emptyNotebook } from "../../../../packages/@moku-core/src/notebook/state.ts";
import * as Outputs from "../../src/plugins/notebook/outputs.ts";

function fixture() {
  const state = emptyNotebook();
  state.cells.c = Protocol.Cell.parse({
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
  const old = Protocol.Execution.parse({
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
  const pending = Protocol.Execution.parse({
    ...old,
    id: "pending",
    run_id: "next",
    status: "queued",
    started_at: null,
    completed_at: null,
    outcome: null,
  });
  state.executions = { old, pending };
  return { state, old, pending };
}

Vitest.test("a rerun is active while queued and retains the previous result", () => {
  const { state, old, pending } = fixture();
  const queued = Outputs.select(state);
  Vitest.expect(queued.current.get("c")).toBe(pending);
  Vitest.expect(queued.results.get("c")).toBe(old);

  const running = {
    ...pending,
    status: "running" as const,
    started_at: "2026-11-12T12:01:00Z",
  };
  state.executions.pending = running;
  const active = Outputs.select(state, queued);
  Vitest.expect(active.current.get("c")).toBe(running);
  Vitest.expect(active.results.get("c")).toBe(old);

  const completed = {
    ...running,
    status: "completed" as const,
    completed_at: "2026-11-12T12:01:03Z",
    outcome: old.outcome,
  };
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

Vitest.test(
  "cell selection shares one output index and refreshes it on updates",
  () => {
    const { state, old } = fixture();
    state.cells.other = { ...state.cells.c, id: "other" };
    state.executions.other = { ...old, id: "other", cell_id: "other" };
    state.displays.d = {
      id: "d",
      execution_id: "pending",
      seq: 2,
      content: { mimetype: "text/plain", data: "first" },
    };
    const consoles = {
      c: {
        id: "c",
        execution_id: "pending",
        seq: 1,
        name: "stdout" as const,
        text: "one",
      },
      other: {
        id: "other",
        execution_id: "other",
        seq: 0,
        name: "stderr" as const,
        text: "two",
      },
    };
    let reads = 0;
    Object.defineProperty(state, "consoles", {
      get() {
        reads++;
        return consoles;
      },
    });
    const selection = Outputs.select(state);
    Vitest.expect(
      Outputs.forCell(state, selection, "c").items.map((item) => item.id),
    ).toEqual(["c", "d"]);
    Vitest.expect(
      Outputs.forCell(state, selection, "other").items.map((item) => item.id),
    ).toEqual(["other"]);
    Vitest.expect(reads).toBe(1);

    state.displays = {};
    const next = Outputs.select(state, selection);
    Vitest.expect(
      Outputs.forCell(state, next, "c").items.map((item) => item.id),
    ).toEqual(["c"]);
    Vitest.expect(reads).toBe(2);
    Vitest.expect(Outputs.forCell(state, selection, "c").items).toHaveLength(2);
  },
);
