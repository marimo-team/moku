import { Schema } from "effect";
// @vitest-environment happy-dom
import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import * as React from "react";
import * as ReactDOMClient from "react-dom/client";
import * as Protocol from "@moku/core/Protocol";
import type { NotebookState } from "../../src/plugins/graph-explainer/execution.ts";
import { CellDetails } from "../../src/plugins/graph-explainer/CellDetails.tsx";
import { RunLog } from "../../src/plugins/graph-explainer/RunLog.tsx";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const roots: ReturnType<typeof ReactDOMClient.createRoot>[] = [];
Vitest.afterEach(async () => {
  await React.act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

async function mount(node: React.ReactNode) {
  const element = document.createElement("div");
  document.body.append(element);
  const root = ReactDOMClient.createRoot(element);
  roots.push(root);
  const render = async (next: React.ReactNode) => {
    await React.act(async () => root.render(next));
  };
  await render(node);
  return {
    element,
    render,
    async click(label: string) {
      const button = [...element.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(label),
      );
      Vitest.expect(button).toBeDefined();
      await React.act(async () => button!.click());
    },
    panel: () => element.querySelector('[role="tabpanel"]')!,
  };
}

function fixture() {
  const run = Schema.decodeUnknownSync(Protocol.Run)({
    id: "current",
    notebook_id: "n",
    runtime_id: "rt",
    created_at: "2026-11-05T12:00:00Z",
    origin: { kind: "cells", cell_ids: ["c"] },
    state: {
      status: "completed",
      started_at: "2026-11-05T12:00:00Z",
      completed_at: "2026-11-05T12:00:00Z",
      outcome: { kind: "succeeded" },
    },
  });
  const execution = (id: string, runId: string, cellId: string | null) =>
    Schema.decodeUnknownSync(Protocol.Execution)({
      id,
      run_id: runId,
      runtime_id: "rt",
      cell_id: cellId,
      code_fingerprint: "v1",
      caused_by_id: null,
      created_at: null,
      state: {
        status: "completed",
        started_at: null,
        completed_at: run.created_at,
        depends_on: {},
        outcome: {
          kind: "succeeded",
        },
      },
    });
  const chunk = (id: string, executionId: string, seq: number, name = "stdout") =>
    Schema.decodeUnknownSync(Protocol.Console)({
      id,
      execution_id: executionId,
      seq,
      content: { kind: "text", stream: name, text: id },
    });
  const display = (id: string, executionId: string, seq: number) =>
    Schema.decodeUnknownSync(Protocol.Console)({
      id,
      execution_id: executionId,
      seq,
      content: { kind: "media", media: { mimetype: "text/plain", data: id } },
    });
  const cells = ["c", "other"].map((id) =>
    Schema.decodeUnknownSync(Protocol.Cell)({
      id,
      notebook_id: "n",
      code: "x = 1",
      name: "_",
      config: {
        column: null,
        disabled: false,
        hide_code: false,
        expand_output: false,
      },
      etag: "v1",
      code_fingerprint: "v1",
      version: 1,
    }),
  );
  const state = {
    ready: true,
    phase: "live",
    notebook: null,
    document: null,
    analysis: null,
    runtime: null,
    variables: {},
    inputs: {},
    runs: { current: run } as Record<string, typeof Protocol.Run.Type>,
    executions: {
      old: execution("old", "previous", null),
      selected: execution("selected", run.id, "c"),
      other: execution("other", run.id, "other"),
    },
    consoles: {
      second: chunk("second", "other", 1),
      start: chunk("start", "other", 0),
      tail: chunk("tail", "selected", 3, "stderr"),
      stale: chunk("stale", "old", 0),
      first: chunk("first", "selected", 0),
      later: display("later", "selected", 4),
      obsolete: display("obsolete", "old", 0),
      earlier: display("earlier", "selected", 1),
    },
    outputs: {
      selected: Schema.decodeUnknownSync(Protocol.Output)({
        id: "out",
        execution_id: "selected",
        media: { mimetype: "text/plain", data: "selected result" },
      }),
    },
  };
  return {
    state: {
      ...state,
      document: {
        ...Schema.decodeUnknownSync(Protocol.Document)({
          notebook_id: "n",
          order: cells.map((cell) => cell.id),
          app_config: {},
          etag: "v1",
          saved_etag: "v1",
          order_etag: "v1",
          app_config_etag: "v1",
          version: 1,
        }),
        cells,
      },
    } satisfies NotebookState,
    run,
  };
}

Vitest.test(
  "DAG tabs and the run log render only the selected run's outputs",
  async () => {
    const { state, run } = fixture();
    const view = await mount(
      <CellDetails state={state} run={run} cellId="c" onClose={() => {}} />,
    );
    await view.click("Logs");
    Vitest.expect(view.panel().textContent).toBe("firsttail");
    Vitest.expect(
      view.panel().querySelector('[data-channel="stderr"]')?.textContent,
    ).toBe("tail");
    await view.click("Output");
    Vitest.expect(view.panel().textContent).toBe("earlierlaterselected result");
    Vitest.expect(
      view.panel().querySelector('[aria-label="Console output"]'),
    ).toBeNull();

    await view.render(<RunLog state={state} run={run} />);
    await view.click("Run log");
    const logs = view.element.querySelectorAll(".run-log");
    Vitest.expect(logs).toHaveLength(1);
    Vitest.expect(logs[0].textContent).toBe("firstearliertaillaterstartsecond");
    Vitest.expect(
      [...view.element.querySelectorAll('[aria-label="Console output"]')]
        .map((entry) => entry.textContent)
        .join(""),
    ).toBe("firsttailstartsecond");
  },
);

Vitest.test(
  "the output tab renders errors once and updates to an empty execution",
  async () => {
    const initial = fixture();
    const run = initial.run;
    const traceback = { mimetype: "text/plain", data: "traceback detail" };
    let state: NotebookState = {
      ...initial.state,
      executions: {
        ...initial.state.executions,
        selected: {
          ...initial.state.executions.selected,
          state: {
            status: "completed",
            started_at: null,
            completed_at: null,
            depends_on: {},
            outcome: {
              kind: "failed",
              error: Schema.decodeUnknownSync(Protocol.Error)({
                kind: "exception",
                name: "ValueError",
                message: "bad value",
                source: "marimo",
                severity: "error",
                range: null,
                related: [],
                traceback,
              }),
            },
          },
        },
      },
      outputs: {},
      consoles: {
        duplicate: {
          id: Schema.decodeUnknownSync(Protocol.ItemId)("duplicate"),
          execution_id: Schema.decodeUnknownSync(Protocol.ExecutionId)("selected"),
          seq: 0,
          content: { kind: "media", media: traceback },
        },
      },
    };
    const render = () => (
      <CellDetails state={state} run={run} cellId="c" onClose={() => {}} />
    );
    const view = await mount(render());
    await view.click("Output");
    Vitest.expect(view.element.textContent?.match(/ValueError/g)).toHaveLength(1);
    Vitest.expect(view.panel().textContent?.match(/traceback detail/g)).toHaveLength(1);
    Vitest.expect(view.panel().textContent).not.toContain("No rendered output");

    state = {
      ...state,
      executions: {
        ...state.executions,
        selected: {
          ...state.executions.selected,
          state: {
            status: "completed",
            started_at: null,
            completed_at: null,
            depends_on: {},
            outcome: { kind: "cancelled" },
          },
        },
      },
      consoles: {},
    };
    await view.render(render());
    Vitest.expect(view.panel().textContent).toBe("Cancelled");

    state = { ...state, executions: {} };
    await view.render(render());
    Vitest.expect(view.panel().textContent).toBe(
      "No rendered output for this execution.",
    );
    await view.click("Logs");
    Vitest.expect(view.panel().textContent).toBe(
      "No console output for this execution.",
    );
  },
);

Vitest.test(
  "live cell details retain outputs across downstream runs and discard prior runtimes",
  async () => {
    const { state: initial, run } = fixture();
    const runtime = Schema.decodeUnknownSync(Protocol.Runtime)({
      id: "rt",
      notebook_id: "n",
      marimo_version: null,
      created_at: Schema.decodeUnknownSync(Protocol.Timestamp)("2026-11-05T11:00:00Z"),
      state: { status: "ready" },
    });
    let state = { ...initial, runtime };
    state.runs.downstream = {
      ...run,
      id: Schema.decodeUnknownSync(Protocol.RunId)("downstream"),
      origin: {
        kind: "cells",
        cell_ids: [Schema.decodeUnknownSync(Protocol.CellId)("other")],
      },
      created_at: Schema.decodeUnknownSync(Protocol.Timestamp)("2026-11-05T13:00:00Z"),
    };
    const render = () => <CellDetails state={state} cellId="c" onClose={() => {}} />;
    const view = await mount(render());
    await view.click("Output");
    Vitest.expect(view.panel().textContent).toBe("earlierlaterselected result");
    state = {
      ...state,
      runtime: {
        ...runtime,
        id: Schema.decodeUnknownSync(Protocol.RuntimeId)("replacement"),
      },
    };
    await view.render(render());
    Vitest.expect(view.panel().textContent).toBe(
      "No rendered output for this execution.",
    );
  },
);
