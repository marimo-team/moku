import * as React from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/reactivity";
import type * as Workspace from "./Workspace.ts";
import { Cause } from "effect";
import type * as Host from "@moku/core/Host";
import type * as Notebook from "@moku/core/Notebook";

const empty = Atom.make<AsyncResult.AsyncResult<Host.State, Notebook.Error>>(
  AsyncResult.initial(),
);
export function useCatalog(workspace: Workspace.Interface, connectionId: string) {
  const atom = React.useMemo(
    () => (connectionId ? workspace.catalog(connectionId) : empty),
    [workspace, connectionId],
  );
  const result = useAtomValue(atom);
  const state = AsyncResult.getOrElse(result, () => undefined);
  return {
    notebooks: Object.values(state?.notebooks ?? {}),
    ready: AsyncResult.isSuccess(result) && !result.waiting,
    error: AsyncResult.isFailure(result) ? Cause.pretty(result.cause) : "",
  };
}
