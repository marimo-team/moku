/** Connection presentation for notebook views. @module */
import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
const empty: Notebook.State = {
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
export function read(result: AsyncResult.AsyncResult<Notebook.State, Notebook.Error>) {
  return {
    value: AsyncResult.getOrElse(result, () => empty),
    ready: AsyncResult.isSuccess(result) && !result.waiting,
    status: AsyncResult.isInitial(result)
      ? ("connecting" as const)
      : result.waiting
        ? ("reconnecting" as const)
        : AsyncResult.isFailure(result)
          ? ("error" as const)
          : ("connected" as const),
    error: AsyncResult.isFailure(result) ? Cause.squash(result.cause) : null,
  };
}
