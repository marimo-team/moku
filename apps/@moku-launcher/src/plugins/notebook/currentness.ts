/* Copyright 2026 Marimo. All rights reserved. */

/**
 * Whether each cell's result still reflects the document and the values
 * it read, by the host protocol's rules.
 *
 * A completed execution is current when its code fingerprint equals the
 * cell's, every variable it depends on still holds the recorded revision,
 * every name it depends on that was unbound is still unbound, and the
 * executions that bound those variables are current. See the freshness
 * section of `protocols/host/spec.md`.
 *
 * The protocol also ranks why a result is outdated. The editor asks two
 * questions of its own, so that is what this reports; the ranked reason
 * can come back with a reader. Two editor concerns are folded in: a name
 * bound only by an earlier runtime is unbound in this one, and a queued or
 * running execution for the cell's current source already covers it.
 */

import type * as Protocol from "@moku/core/Protocol";

type Cell = typeof Protocol.Cell.Type;
type Execution = typeof Protocol.Execution.Type;
type Variable = typeof Protocol.Variable.Type;

/** What freshness is derived from. */
export interface CellFreshnessInputs {
  /** The document's cells, for the fingerprint of each cell's source. */
  readonly cells: ReadonlyMap<string, Cell>;
  /** The stream's executions, for the variables currently bound. */
  readonly executions: ReadonlyMap<string, Execution>;
  readonly variables: ReadonlyMap<string, Variable>;
  /** Each cell's last completed record, the result being compared. */
  readonly results: ReadonlyMap<string, Execution | null>;
}

export type Reason = "Not run" | "Source changed" | "Inputs changed";

/** One lookup per confirmed snapshot; pending local edits do not affect it. */
export function forNotebook(inputs: CellFreshnessInputs) {
  const bound = Map.groupBy(inputs.variables.values(), (variable) => variable.name);
  const memo = new Map<string, boolean>();
  const pending = new Set<string>();
  for (const execution of inputs.executions.values()) {
    if (execution.cell_id !== null && execution.state.status !== "completed") {
      pending.add(execution.cell_id);
    }
  }

  /** Whether a value the record read has changed, or one upstream has. */
  function checkDependencies(
    record: Execution,
    visiting: ReadonlySet<string>,
  ): boolean {
    const state = record.state;
    if (state.status !== "completed") return false;
    const path = new Set(visiting).add(record.id);
    for (const [name, revision] of Object.entries(state.depends_on)) {
      const variables = bound.get(name) ?? [];
      if (revision === null) {
        // Older runtimes bind nothing here, but a later binding invalidates
        // the result even if its runtime has since stopped.
        if (
          variables.some((v) => {
            const binder = inputs.executions.get(v.execution_id);
            if (binder === undefined) {
              return false;
            }
            if (binder.runtime_id === record.runtime_id) {
              return true;
            }
            const boundAt =
              binder.state.status === "completed"
                ? (binder.state.completed_at ?? binder.state.started_at)
                : binder.created_at;
            return (
              boundAt !== null &&
              state.completed_at !== null &&
              Date.parse(boundAt) > Date.parse(state.completed_at)
            );
          })
        ) {
          return true;
        }
        continue;
      }
      const variable = variables.find(
        (candidate) => candidate.revision.execution_id === revision.execution_id,
      );
      if (variable === undefined || variable.revision.update !== revision.update) {
        return true;
      }
      const binder = inputs.executions.get(variable.execution_id);
      if (binder === undefined) {
        return true;
      }
      if (!path.has(binder.id) && inputsChanged(binder, path)) {
        return true;
      }
    }
    return false;
  }

  function inputsChanged(record: Execution, visiting: ReadonlySet<string>): boolean {
    const known = memo.get(record.id);
    if (known !== undefined) return known;
    const changed = checkDependencies(record, visiting);
    memo.set(record.id, changed);
    return changed;
  }

  return (id: string): Reason | null => {
    const cell = inputs.cells.get(id);
    if (!cell || pending.has(id)) return null;
    const result = inputs.results.get(id);
    if (!result) return "Not run";
    if (cell.code_fingerprint !== result.code_fingerprint) return "Source changed";
    if (inputsChanged(result, new Set())) return "Inputs changed";
    return null;
  };
}
