import type * as Protocol from "@marimo-team/client/protocol";

export interface NotebookState {
  ready: boolean;
  notebook: Protocol.NotebookOutput | null;
  document: Protocol.DocumentOutput | null;
  analysis: Protocol.AnalysisOutput | null;
  runtime: Protocol.RuntimeOutput | null;
  cells: Record<string, Protocol.CellOutput>;
  runs: Record<string, Protocol.RunOutput>;
  executions: Record<string, Protocol.ExecutionOutput>;
  consoles: Record<string, Protocol.ConsoleOutput>;
  displays: Record<string, Protocol.DisplayOutput>;
  variables: Record<string, Protocol.VariableOutput>;
  inputs: Record<string, Protocol.InputOutput>;
}

export function emptyNotebook(): NotebookState {
  return {
    ready: false,
    notebook: null,
    document: null,
    analysis: null,
    runtime: null,
    cells: {},
    runs: {},
    executions: {},
    consoles: {},
    displays: {},
    variables: {},
    inputs: {},
  };
}

function without<T>(records: Record<string, T>, id: string): Record<string, T> {
  const next = { ...records };
  delete next[id];
  return next;
}

function withoutExecution<T extends { execution_id: string }>(
  records: Record<string, T>,
  id: string,
) {
  return Object.fromEntries(Object.entries(records).filter(([, item]) => item.execution_id !== id));
}

export function reduceNotebook(state: NotebookState, event: Protocol.EventOutput): NotebookState {
  switch (event.event) {
    case "reset":
    case "notebook.removed":
      return emptyNotebook();
    case "ready":
      return { ...state, ready: true };
    case "notebook":
      return { ...state, notebook: event.data.notebook };
    case "document":
      return { ...state, document: event.data.document };
    case "analysis":
      return { ...state, analysis: event.data.analysis };
    case "runtime":
      return { ...state, runtime: event.data.runtime };
    case "runtime.removed":
      return {
        ...state,
        runtime: state.runtime?.id === event.data.id ? null : state.runtime,
      };
    case "cell":
      return {
        ...state,
        cells: { ...state.cells, [event.data.cell.id]: event.data.cell },
      };
    case "cell.removed":
      return { ...state, cells: without(state.cells, event.data.id) };
    case "run":
      return {
        ...state,
        runs: { ...state.runs, [event.data.run.id]: event.data.run },
      };
    case "run.removed":
      return { ...state, runs: without(state.runs, event.data.id) };
    case "execution":
      return {
        ...state,
        executions: {
          ...state.executions,
          [event.data.execution.id]: event.data.execution,
        },
      };
    case "execution.removed":
      return {
        ...state,
        executions: without(state.executions, event.data.id),
        consoles: withoutExecution(state.consoles, event.data.id),
        displays: withoutExecution(state.displays, event.data.id),
        variables: withoutExecution(state.variables, event.data.id),
        inputs: withoutExecution(state.inputs, event.data.id),
      };
    case "console":
      return {
        ...state,
        consoles: {
          ...state.consoles,
          [event.data.console.id]: event.data.console,
        },
      };
    case "console.removed":
      return { ...state, consoles: without(state.consoles, event.data.id) };
    case "display":
      return {
        ...state,
        displays: {
          ...state.displays,
          [event.data.display.id]: event.data.display,
        },
      };
    case "display.removed":
      return { ...state, displays: without(state.displays, event.data.id) };
    case "variable":
      return {
        ...state,
        variables: {
          ...state.variables,
          [event.data.variable.id]: event.data.variable,
        },
      };
    case "variable.removed":
      return { ...state, variables: without(state.variables, event.data.id) };
    case "input":
      return {
        ...state,
        inputs: { ...state.inputs, [event.data.input.id]: event.data.input },
      };
    default:
      return state;
  }
}

export type CellStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "interrupted"
  | "disabled"
  | "waiting";

export function cellStatus(
  cell: Protocol.CellOutput,
  execution: Protocol.ExecutionOutput | undefined,
  inputs: Protocol.InputOutput[],
): CellStatus {
  if (!execution) return cell.config.disabled ? "disabled" : "pending";
  if (
    execution.status === "running" &&
    inputs.some((input) => input.execution_id === execution.id && input.status === "pending")
  )
    return "waiting";
  if (execution.status !== "completed") return execution.status;
  switch (execution.outcome?.kind) {
    case "value":
      return "succeeded";
    case "error":
      return "failed";
    case "skipped":
      return "skipped";
    case "interrupted":
      return "interrupted";
    default:
      return "pending";
  }
}

export function cellLabel(cell: Protocol.CellOutput, index: number) {
  if (cell.name !== "_") return cell.name.replaceAll("_", " ");
  const line = cell.code?.split("\n").find((line) => line.trim());
  if (line?.trim().startsWith("#")) return line.trim().replace(/^#+\s*/, "");
  return line?.trim().slice(0, 72) || `Cell ${index + 1}`;
}

export function duration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function newestRun(state: NotebookState) {
  return Object.values(state.runs).sort((a, b) => {
    if (a.status !== "completed" && b.status === "completed") return -1;
    if (b.status !== "completed" && a.status === "completed") return 1;
    return (
      Date.parse(b.started_at ?? b.completed_at ?? "") -
      Date.parse(a.started_at ?? a.completed_at ?? "")
    );
  })[0];
}

export function executionSpan(
  executions: Pick<Protocol.ExecutionOutput, "started_at" | "completed_at">[],
  now: number,
) {
  const started = executions.filter((execution) => execution.started_at !== null);
  if (!started.length) return null;
  const start = Math.min(...started.map((execution) => Date.parse(execution.started_at!)));
  const end = Math.max(
    ...started.map((execution) =>
      execution.completed_at ? Date.parse(execution.completed_at) : now,
    ),
  );
  return {
    start,
    duration: Math.max(0, end - start),
    open: started.some((execution) => execution.completed_at === null),
  };
}
