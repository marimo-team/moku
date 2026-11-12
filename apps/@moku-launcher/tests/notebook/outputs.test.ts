import { expect, test } from "vite-plus/test";
import * as Protocol from "@moku/core/Protocol";
import { emptyNotebook } from "../../../../packages/@moku-core/src/notebook/state.ts";
import { select } from "../../src/plugins/notebook/outputs.ts";

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

test("a rerun is active while queued and retains the previous result", () => {
  const { state, old, pending } = fixture();
  const queued = select(state);
  expect(queued.current.get("c")).toBe(pending);
  expect(queued.results.get("c")).toBe(old);

  const running = {
    ...pending,
    status: "running" as const,
    started_at: "2026-11-12T12:01:00Z",
  };
  state.executions.pending = running;
  const active = select(state, queued);
  expect(active.current.get("c")).toBe(running);
  expect(active.results.get("c")).toBe(old);

  const completed = {
    ...running,
    status: "completed" as const,
    completed_at: "2026-11-12T12:01:03Z",
    outcome: old.outcome,
  };
  state.executions.pending = completed;
  const done = select(state, active);
  expect(done.current.get("c")).toBe(completed);
  expect(done.results.get("c")).toBe(completed);
});

test("snapshot record order does not hide a queued rerun", () => {
  const { state, old, pending } = fixture();
  state.executions = { pending, old };
  expect(select(state).current.get("c")).toBe(pending);
});
