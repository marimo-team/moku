// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import * as Protocol from "@moku/core/Protocol";
import type { NotebookState } from "../../src/plugins/dag/notebook/model.ts";
import { CellDetails } from "../../src/plugins/dag/notebook/CellDetails.tsx";
import { RunLog } from "../../src/plugins/dag/notebook/RunLog.tsx";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

async function mount(node: ReactNode) {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  roots.push(root);
  const render = async (next: ReactNode) => {
    await act(async () => root.render(next));
  };
  await render(node);
  return {
    element,
    render,
    async click(label: string) {
      const button = [...element.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(label),
      );
      expect(button).toBeDefined();
      await act(async () => button!.click());
    },
    panel: () => element.querySelector('[role="tabpanel"]')!,
  };
}

function fixture() {
  const run = Protocol.Run.parse({
    id: "current",
    notebook_id: "n",
    runtime_id: "rt",
    cells: ["c"],
    status: "completed",
    outcome: "succeeded",
    started_at: null,
    completed_at: "2026-11-05T12:00:00Z",
  });
  const execution = (id: string, runId: string) =>
    Protocol.Execution.parse({
      id,
      run_id: runId,
      runtime_id: "rt",
      caused_by: null,
      cell_id: "c",
      code: null,
      code_fingerprint: "v1",
      depends_on: {},
      status: "completed",
      started_at: null,
      completed_at: run.completed_at,
      outcome: {
        kind: "value",
        display: { mimetype: "text/plain", data: `${id} result` },
      },
    });
  const chunk = (id: string, executionId: string, seq: number, name = "stdout") =>
    Protocol.Console.parse({ id, execution_id: executionId, seq, name, text: id });
  const display = (id: string, executionId: string, seq: number) =>
    Protocol.Display.parse({
      id,
      execution_id: executionId,
      seq,
      content: { mimetype: "text/plain", data: id },
    });
  const state: NotebookState = {
    ready: true,
    phase: "live",
    notebook: null,
    document: null,
    analysis: null,
    runtime: null,
    variables: {},
    inputs: {},
    runs: { current: run },
    cells: {
      c: Protocol.Cell.parse({
        id: "c",
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
    },
    executions: {
      old: execution("old", "previous"),
      selected: execution("selected", run.id),
    },
    consoles: {
      tail: chunk("tail", "selected", 3, "stderr"),
      stale: chunk("stale", "old", 0),
      first: chunk("first", "selected", 1),
    },
    displays: {
      later: display("later", "selected", 4),
      obsolete: display("obsolete", "old", 0),
      earlier: display("earlier", "selected", 2),
    },
  };
  return { state, run };
}

test("DAG tabs and the run log render only the selected run's outputs", async () => {
  const { state, run } = fixture();
  const view = await mount(
    <CellDetails state={state} run={run} cellId="c" onClose={() => {}} />,
  );
  await view.click("Logs");
  expect(view.panel().textContent).toBe("firsttail");
  expect(view.panel().querySelector('[data-channel="stderr"]')?.textContent).toBe(
    "tail",
  );
  await view.click("Output");
  expect(view.panel().textContent).toBe("earlierlaterselected result");
  expect(view.panel().querySelector('[aria-label="Console output"]')).toBeNull();

  await view.render(<RunLog state={state} run={run} />);
  await view.click("Run log");
  expect(view.element.querySelector('[aria-label="Console output"]')?.textContent).toBe(
    "firsttail",
  );
});

test("the output tab renders errors once and updates to an empty execution", async () => {
  const initial = fixture();
  const run = initial.run;
  const traceback = { mimetype: "text/plain", data: "traceback detail" };
  let state: NotebookState = {
    ...initial.state,
    executions: {
      ...initial.state.executions,
      selected: {
        ...initial.state.executions.selected,
        outcome: {
          kind: "error",
          error: Protocol.Error.parse({
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
    displays: {
      duplicate: {
        id: "duplicate",
        execution_id: "selected",
        seq: 0,
        content: traceback,
      },
    },
  };
  const render = () => (
    <CellDetails state={state} run={run} cellId="c" onClose={() => {}} />
  );
  const view = await mount(render());
  await view.click("Output");
  expect(view.element.textContent?.match(/ValueError/g)).toHaveLength(1);
  expect(view.panel().textContent?.match(/traceback detail/g)).toHaveLength(1);
  expect(view.panel().textContent).not.toContain("No rendered output");

  state = {
    ...state,
    executions: {
      ...state.executions,
      selected: { ...state.executions.selected, outcome: { kind: "interrupted" } },
    },
    displays: {},
  };
  await view.render(render());
  expect(view.panel().textContent).toBe("Interrupted");

  state = { ...state, executions: {} };
  await view.render(render());
  expect(view.panel().textContent).toBe("No rendered output for this execution.");
  await view.click("Logs");
  expect(view.panel().textContent).toBe("No console output for this execution.");
});

test("live cell details retain outputs across downstream runs and discard prior runtimes", async () => {
  const { state: initial, run } = fixture();
  const runtime = Protocol.Runtime.parse({
    id: "rt",
    notebook_id: "n",
    status: "running",
    message: null,
    marimo_version: null,
    started_at: "2026-11-05T11:00:00Z",
  });
  let state: NotebookState = { ...initial, runtime };
  state.executions.old = {
    ...state.executions.old,
    started_at: "2026-11-05T11:00:00Z",
  };
  state.executions.selected = {
    ...state.executions.selected,
    started_at: "2026-11-05T12:00:00Z",
  };
  state.runs.downstream = {
    ...run,
    id: "downstream",
    cells: ["other"],
    completed_at: "2026-11-05T13:00:00Z",
  };
  const render = () => <CellDetails state={state} cellId="c" onClose={() => {}} />;
  const view = await mount(render());
  await view.click("Output");
  expect(view.panel().textContent).toBe("earlierlaterselected result");
  state = { ...state, runtime: { ...runtime, id: "replacement" } };
  await view.render(render());
  expect(view.panel().textContent).toBe("No rendered output for this execution.");
});
