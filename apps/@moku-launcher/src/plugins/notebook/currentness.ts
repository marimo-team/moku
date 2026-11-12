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

type Cell = Protocol.CellOutput;
type Execution = Protocol.ExecutionOutput;
type Variable = Protocol.VariableOutput;

export interface CellFreshness {
  /** This cell's source differs from its pending execution, or its last result. */
  readonly sourceChanged: boolean;
  /**
   * A value the result read changed since, by a rerun or an update, here
   * or upstream. An ancestor that was only edited does not count: its
   * values are still the ones this result read.
   */
  readonly inputsChanged: boolean;
}

/** Current, and also a cell with no completed execution to compare. */
const CURRENT: CellFreshness = { sourceChanged: false, inputsChanged: false };

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

/** Freshness by cell id, as `freshnessOf` builds it. */
export type CellFreshnessLookup = (id: string) => CellFreshness;

/** The variables bound in the namespace right now, by name. */
function boundVariables(
  variables: ReadonlyMap<string, Variable>,
): ReadonlyMap<string, Variable[]> {
  const byName = new Map<string, Variable[]>();
  for (const variable of variables.values()) {
    const bound = byName.get(variable.name);
    if (bound === undefined) {
      byName.set(variable.name, [variable]);
    } else {
      bound.push(variable);
    }
  }
  return byName;
}

/**
 * Compares results against the document and the namespace.
 *
 * Build one per set of inputs and ask it about each cell, since the
 * bound variables are indexed once and a binding execution's freshness is
 * computed once however many results depend on it.
 */
export function freshnessOf(inputs: CellFreshnessInputs): CellFreshnessLookup {
  const bound = boundVariables(inputs.variables);
  const memo = new Map<string, CellFreshness>();
  const pendingByCell = new Map<string, Execution>();
  for (const execution of inputs.executions.values()) {
    if (execution.cell_id !== null && execution.status !== "completed") {
      pendingByCell.set(execution.cell_id, execution);
    }
  }
  const recordOf = (id: string) => inputs.executions.get(id);

  /** Whether a value the record read has changed, or one upstream has. */
  function inputsChanged(record: Execution, visiting: ReadonlySet<string>): boolean {
    const path = new Set(visiting).add(record.id);
    for (const [name, revision] of Object.entries(record.depends_on)) {
      const variables = bound.get(name) ?? [];
      if (revision === null) {
        // Older runtimes bind nothing here, but a later binding invalidates
        // the result even if its runtime has since stopped.
        if (
          variables.some((v) => {
            const binder = recordOf(v.execution_id);
            if (binder === undefined) {
              return false;
            }
            if (binder.runtime_id === record.runtime_id) {
              return true;
            }
            const boundAt = binder.completed_at ?? binder.started_at;
            return (
              boundAt !== null &&
              record.completed_at !== null &&
              Date.parse(boundAt) > Date.parse(record.completed_at)
            );
          })
        ) {
          return true;
        }
        continue;
      }
      const variable = variables.find(
        (candidate) => candidate.revision.execution === revision.execution,
      );
      if (variable === undefined || variable.revision.update !== revision.update) {
        return true;
      }
      const binder = recordOf(variable.execution_id);
      if (binder === undefined) {
        return true;
      }
      if (!path.has(binder.id) && ofRecord(binder, path).inputsChanged) {
        return true;
      }
    }
    return false;
  }

  /** Compare against pending work before the result it will replace. */
  function sourceChanged(cell: Cell, result: Execution): boolean {
    const pending = pendingByCell.get(cell.id);
    const source =
      pending !== undefined && pending.status !== "completed" ? pending : result;
    return cell.code_fingerprint !== source.code_fingerprint;
  }

  function ofRecord(record: Execution, visiting: ReadonlySet<string>): CellFreshness {
    const known = memo.get(record.id);
    if (known !== undefined) {
      return known;
    }
    const cell = record.cell_id === null ? undefined : inputs.cells.get(record.cell_id);
    const freshness: CellFreshness = {
      sourceChanged: cell === undefined || sourceChanged(cell, record),
      inputsChanged: inputsChanged(record, visiting),
    };
    memo.set(record.id, freshness);
    return freshness;
  }

  return (id) => {
    const result = inputs.results.get(id);
    return result === null || result === undefined
      ? CURRENT
      : ofRecord(result, new Set());
  };
}

export type Reason = "Not run" | "Source changed" | "Inputs changed";

/** One lookup per confirmed snapshot; pending local edits do not affect it. */
export function forNotebook(inputs: CellFreshnessInputs) {
  const freshness = freshnessOf(inputs);
  const pending = new Map<string, Execution>();
  for (const execution of inputs.executions.values()) {
    if (execution.cell_id !== null && execution.status !== "completed") {
      pending.set(execution.cell_id, execution);
    }
  }
  return (id: string): Reason | null => {
    const confirmed = inputs.cells.get(id);
    if (!confirmed) return null;
    const result = inputs.results.get(id);
    const active = pending.get(id);
    // The old result is still displayed while its replacement runs. Wait for
    // that work to resolve instead of marking the result it is replacing.
    if (active) return null;
    if (!result) return "Not run";
    const currentness = freshness(id);
    if (currentness.sourceChanged) return "Source changed";
    if (currentness.inputsChanged) return "Inputs changed";
    return null;
  };
}
