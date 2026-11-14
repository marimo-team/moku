import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import * as Notebook from "../src/Notebook.ts";
import { emptyNotebook, type NotebookState } from "../src/notebook/state.ts";

/** Adapt reducer fixtures to the public observation shape. */
export function snapshot(value: NotebookState): Notebook.State {
  return {
    ...value,
    analysis:
      value.document && value.analysis?.document_etag === value.document.etag
        ? value.analysis
        : null,
    document: value.document
      ? {
          ...value.document,
          cells: value.document.order.flatMap((id) => value.cells[id] ?? []),
        }
      : null,
  };
}
export interface Observation {
  value: NotebookState;
  status: "connected" | "connecting" | "reconnecting" | "closed" | "error";
  error: Error | null;
  source?: unknown;
}
export function result(
  observation: Observation,
): AsyncResult.AsyncResult<Notebook.State, Notebook.Error> {
  const value = snapshot(observation.value);
  if (observation.error)
    return AsyncResult.failure(
      Cause.fail(
        new Notebook.ModelError({
          reason: "invalid-state",
          message: observation.error.message,
        }),
      ),
    );
  return AsyncResult.success(value, { waiting: observation.status !== "connected" });
}
export function read(value: AsyncResult.AsyncResult<Notebook.State, Notebook.Error>) {
  const state = AsyncResult.getOrElse(value, () => undefined);
  const cause = AsyncResult.isFailure(value) ? Cause.squash(value.cause) : undefined;
  const error =
    cause === undefined
      ? null
      : cause instanceof Error
        ? cause
        : new Error(JSON.stringify(cause));
  const ready = AsyncResult.isSuccess(value) && !value.waiting;
  return {
    value: {
      ...emptyNotebook(),
      ...state,
      ready,
      cells: Object.fromEntries(
        state?.document?.cells.map((cell) => [cell.id, cell]) ?? [],
      ),
    },
    source: {
      document: state?.document
        ? {
            revision: state.document,
            cells: new Map<string, import("../src/Protocol.ts").CellOutput>(
              state.document.cells.map((cell) => [cell.id, cell]),
            ),
          }
        : null,
      canEdit:
        ready &&
        state?.notebook?.operations.includes("notebook.edit") === true &&
        state.document !== null,
    },
    status: AsyncResult.isInitial(value)
      ? "connecting"
      : value.waiting
        ? "reconnecting"
        : error
          ? "error"
          : "connected",
    error,
  };
}
