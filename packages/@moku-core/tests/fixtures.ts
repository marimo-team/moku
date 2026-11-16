import type * as Notebook from "../src/Notebook.ts";

export function emptyState(): Notebook.State {
  return {
    notebook: null,
    document: null,
    runtime: null,
    analysis: null,
    runs: {},
    executions: {},
    consoles: {},
    displays: {},
    variables: {},
    inputs: {},
  };
}
