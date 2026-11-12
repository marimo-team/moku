/**
 * Reduce notebook events into the state exposed to views.
 *
 * @module
 */
import type * as Protocol from "../Protocol.ts";
import * as Confirmed from "./confirmed.ts";

export interface NotebookState {
  phase: "snapshot" | "replay" | "live";
  confirmed: Confirmed.State;
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
    phase: "snapshot",
    confirmed: Confirmed.initial,
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
  return Object.fromEntries(
    Object.entries(records).filter(([, item]) => item.execution_id !== id),
  );
}

export function reduceNotebook(
  state: NotebookState,
  event: Protocol.EventOutput,
): NotebookState {
  if (event.event === "reset") return emptyNotebook();
  if (event.event === "notebook.removed") {
    return state.notebook?.id && event.data.id !== state.notebook.id
      ? state
      : { ...emptyNotebook(), phase: state.phase };
  }
  const confirmed = Confirmed.reduce(state.confirmed, event, state.phase);
  if (confirmed !== state.confirmed)
    state = {
      ...state,
      confirmed,
      document: confirmed.current?.revision ?? null,
      cells: Object.fromEntries(confirmed.current?.cells ?? []),
    };
  switch (event.event) {
    case "ready":
      return { ...state, ready: true, phase: "live" };
    case "notebook":
      return { ...state, notebook: event.data.notebook };
    case "analysis":
      return { ...state, analysis: event.data.analysis };
    case "runtime":
      return { ...state, runtime: event.data.runtime };
    case "runtime.removed":
      return {
        ...state,
        runtime: state.runtime?.id === event.data.id ? null : state.runtime,
      };
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
