import * as React from "react";
import { useAtom } from "@effect/atom-react";
import { Cause } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type * as Workspace from "./Workspace.ts";
import type { Target } from "./Notebook.ts";

export function useOpenHost(workspace: Workspace.Workspace, target: Target) {
  const { connectionId, notebookId } = target;
  const action = React.useMemo(
    () =>
      Atom.fn(() =>
        workspace.open({
          connectionId,
          notebookId,
          requestId: crypto.randomUUID(),
        }),
      ).pipe(Atom.setIdleTTL(0)),
    [workspace, connectionId, notebookId],
  );
  const [result, open] = useAtom(action);
  const error =
    !result.waiting && AsyncResult.isFailure(result)
      ? Cause.squash(result.cause)
      : null;
  return {
    open,
    pending: result.waiting,
    error: error
      ? error instanceof Error
        ? error.message
        : "Could not open the notebook."
      : null,
  };
}
