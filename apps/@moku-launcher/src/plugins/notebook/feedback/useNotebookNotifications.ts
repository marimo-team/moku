import type * as Notebook from "@moku/core/Notebook";
import type * as Document from "@moku/editor/Document";
import type { AsyncResult } from "effect/reactivity";
import * as Problems from "./problems.ts";
import { useFailureNotification, useNotification } from "./useNotifications.ts";

interface Options {
  target: Notebook.Target;
  sync: Document.SyncStatus;
  retry: Document.Interface["retry"];
  saving: AsyncResult.AsyncResult<unknown, unknown>;
  execution: AsyncResult.AsyncResult<unknown, unknown>;
  interruption: AsyncResult.AsyncResult<unknown, unknown>;
  cancellation: AsyncResult.AsyncResult<unknown, unknown>;
}

/** Reports command failures and offers retries for unsynchronized edits. */
export function useNotebookNotifications({
  target,
  sync,
  retry,
  saving,
  execution,
  interruption,
  cancellation,
}: Options) {
  const scope = `editor:${target.connectionId}:${target.notebookId}`;
  useFailureNotification(saving, {
    id: `${scope}:save`,
    title: "Could not save notebook",
    suppressed: sync.status === "error",
  });
  useFailureNotification(execution, {
    id: `${scope}:run`,
    title: "Could not run notebook",
    suppressed: sync.status === "error",
  });
  useFailureNotification(interruption, {
    id: `${scope}:interrupt`,
    title: "Could not interrupt execution",
  });
  useFailureNotification(cancellation, {
    id: `${scope}:cancel`,
    title: "Could not cancel startup",
  });
  const problem = sync.status === "error" ? Problems.describe(sync.error) : null;
  useNotification(
    problem
      ? {
          id: `${scope}:edits`,
          kind: "error",
          title: problem.title,
          description: problem.description,
          details: problem.details,
          action: problem.retryable ? { label: "Retry edits", run: retry } : undefined,
        }
      : null,
    `${scope}:edits`,
  );
}
