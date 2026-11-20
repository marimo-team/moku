/** Empty content for views awaiting their first notebook snapshot. @module */
import type * as Notebook from "@moku/core/Notebook";
export const empty: Notebook.State = {
  notebook: null,
  document: null,
  runtime: null,
  analysis: null,
  runs: {},
  executions: {},
  consoles: {},
  outputs: {},
  variables: {},
  inputs: {},
};
