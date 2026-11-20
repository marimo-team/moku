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
    cell_id: "c",
    code_fingerprint: "v1",
    caused_by_id: null,
    created_at: "2026-11-12T12:00:00Z",
    state: {
      status: "completed",
      started_at: "2026-11-12T12:00:00Z",
      completed_at: "2026-11-12T12:00:03Z",
      depends_on: {},
      outcome: { kind: "succeeded" },
    },
  });
  const pending = Schema.decodeUnknownSync(Protocol.Execution)({
    ...old,
    id: "pending",
    run_id: "next",
    state: { status: "queued" },
  });
  const executions: Record<string, typeof Protocol.Execution.Type> = { old };
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
  const previousOutput = Schema.decodeUnknownSync(Protocol.Output)({
    id: "out",
    execution_id: old.id,
    media: { mimetype: "text/plain", data: "previous" },
  });
  state.outputs = { out: previousOutput };
  let selection = Outputs.select(state);
  // The host retires the output and execution in separate events before the rerun.
  state.outputs = {};
  selection = Outputs.select(state, selection);
  Vitest.expect(Outputs.forCell(state, selection, "c").output).toBe(previousOutput);
  state.executions = {};
  selection = Outputs.select(state, selection);
  Vitest.expect(Outputs.forCell(state, selection, "c").output).toBe(previousOutput);
  state.executions = { pending };
  const queued = Outputs.select(state, selection);
  Vitest.expect(Outputs.forCell(state, queued, "c").output).toBe(previousOutput);
  Vitest.expect(queued.current.get("c")).toBe(pending);
  Vitest.expect(queued.results.get("c")).toBe(old);

  const running = Schema.decodeUnknownSync(Protocol.Execution)({
    ...pending,
    state: { status: "running", started_at: "2026-11-12T12:01:00Z" },
  });
  state.executions = { pending: running };
  state.outputs = {};
  const active = Outputs.select(state, queued);
  Vitest.expect(active.current.get("c")).toBe(running);
  Vitest.expect(active.results.get("c")).toBe(old);
  Vitest.expect(Outputs.forCell(state, active, "c").output).toBe(previousOutput);

  const cleared = Schema.decodeUnknownSync(Protocol.Output)({
    id: "next-out",
    execution_id: pending.id,
    media: null,
  });
  state.outputs = { ...state.outputs, next: cleared };
  Vitest.expect(Outputs.forCell(state, Outputs.select(state, active), "c").output).toBe(
    cleared,
  );
  const completed = Schema.decodeUnknownSync(Protocol.Execution)({
    ...running,
    state: { ...old.state, status: "completed", completed_at: "2026-11-12T12:01:03Z" },
  });
  state.executions.pending = completed;
  const done = Outputs.select(state, active);
  Vitest.expect(done.current.get("c")).toBe(completed);
  Vitest.expect(done.results.get("c")).toBe(completed);
});

Vitest.test(
  "a later failure replaces a success even when the host clock moves back",
  () => {
    const { state, pending } = fixture();
    state.outputs = {
      out: Schema.decodeUnknownSync(Protocol.Output)({
        id: "out",
        execution_id: "old",
        media: { mimetype: "text/plain", data: "old result" },
      }),
    };
    const previous = Outputs.select(state);
    const failed = Schema.decodeUnknownSync(Protocol.Execution)({
      ...pending,
      created_at: "2026-11-12T11:00:00Z",
      state: {
        status: "completed",
        started_at: "2026-11-12T11:00:00Z",
        completed_at: "2026-11-12T11:00:01Z",
        depends_on: {},
        outcome: {
          kind: "failed",
          error: {
            kind: "exception",
            name: "ValueError",
            message: "bad value",
            source: "marimo",
            severity: "error",
            range: null,
            related: [],
            traceback: null,
          },
        },
      },
    });
    state.executions = { pending: failed };
    state.outputs = {};
    const selection = Outputs.select(state, previous);
    Vitest.expect(Outputs.forCell(state, selection, "c")).toMatchObject({
      outcome: { kind: "failed" },
      output: null,
    });
  },
);

Vitest.test("each cell shows its own outputs and removed displays disappear", () => {
  const { state, old, pending } = fixture();
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
  state.executions = { pending, other: execution };
  const display = Schema.decodeUnknownSync(Protocol.Output)({
    id: "d",
    execution_id: "pending",
    media: { mimetype: "text/plain", data: "first" },
  });
  state.outputs = { d: display };
  state.consoles = {
    c: Schema.decodeUnknownSync(Protocol.Console)({
      id: "c",
      execution_id: "pending",
      seq: 1,
      content: { kind: "text", stream: "stdout", text: "one" },
    }),
    other: Schema.decodeUnknownSync(Protocol.Console)({
      id: "other",
      execution_id: "other",
      seq: 0,
      content: { kind: "text", stream: "stderr", text: "two" },
    }),
  };
  const selection = Outputs.select(state);
  Vitest.expect(
    Outputs.forCell(state, selection, "c").items.map((item) => item.id),
  ).toEqual(["c"]);
  Vitest.expect(Outputs.forCell(state, selection, "c").output).toBe(display);
  Vitest.expect(
    Outputs.forCell(state, selection, "other").items.map((item) => item.id),
  ).toEqual(["other"]);

  state.outputs = {};
  const next = Outputs.select(state, selection);
  Vitest.expect(Outputs.forCell(state, next, "c").output).toBeNull();
  Vitest.expect(Outputs.forCell(state, next, "c").items.map((item) => item.id)).toEqual(
    ["c"],
  );
});
