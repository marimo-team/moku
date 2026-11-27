import * as Notebook from "@moku/core/Notebook";
import type * as Protocol from "@moku/core/Protocol";
import { Option } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";

import { Graph, type Item, type Trace } from "./graph.ts";

export type Cell = typeof Protocol.Cell.Type & {
  readonly definitions: readonly string[];
  readonly references: readonly string[];
  readonly highlighted: ReadonlySet<string>;
  readonly relation: "selected" | "cycle" | "upstream" | "downstream" | "unrelated";
  readonly direct: boolean;
  readonly error: string | undefined;
  readonly activity: "Running" | "Queued" | "Disabled" | null;
};

export interface Selection extends Trace {
  readonly item: Item;
  readonly graph: Graph;
}

interface Topology {
  readonly items: readonly Item[];
  readonly current: boolean;
}

export interface Row {
  readonly source: typeof Protocol.Cell.Type;
  readonly cell: Cell;
  readonly index: number;
  readonly startsColumn: boolean;
  readonly x: number;
  readonly leftArm: boolean;
  readonly rightArm: boolean;
  readonly referenceable: boolean;
}

export const ROW_HEIGHT = 21;
// Marimo's original gutter, before cell numbers were added, is 51px wide.
export const CENTER = 25;

/** Reactive minimap rows and selection for one notebook. */
export type Interface = ReturnType<typeof make>;

/** Each minimap owns its selection; all reads use the caller's atom registry. */
export function make(state: Notebook.Interface["state"]) {
  const value = Atom.map(state, (state) =>
    AsyncResult.getOrElse(state, () => undefined),
  );
  const cells = Atom.map(value, (value) =>
    value?.document ? Notebook.cellIndex(value.document) : null,
  );
  // Read related records together so a document revision cannot briefly be
  // compared with analysis from the previous snapshot during propagation.
  const structure = Atom.withEquality(
    Atom.map(value, (value) => ({
      document: value?.document ?? null,

      analysis: value?.analysis ?? null,
    })),
    (a, b) => a.document === b.document && a.analysis === b.analysis,
  );
  const currentAnalysis = Atom.map(structure, ({ analysis }) => analysis);
  // Errors and execution events are deliberately absent from graph identity.
  const topology = Atom.map(structure, ({ document, analysis }): Topology => {
    const parents = analysis && Notebook.cellParents(analysis);
    return {
      current: analysis !== null,
      items: (document?.cells ?? []).map(({ id }) => ({
        id,
        definitions: analysis?.cells[id]?.defs ?? [],
        references: analysis?.cells[id]?.refs ?? [],
        parents: parents?.get(id) ?? [],
      })),
    };
  }).pipe(Atom.withEquality(sameTopology));
  const ids = Atom.map(topology, ({ items }) => items.map((item) => item.id)).pipe(
    Atom.withEquality<readonly string[]>(sameArray),
  );
  const graph = Atom.map(topology, ({ items, current }) => new Graph(items, current));

  // Revalidate on membership changes, retaining no selection after deletion.
  const selected = Atom.writable(
    (get): string | null => {
      const members = get(ids);
      const previous = Option.getOrNull(get.self<string | null>());
      return previous !== null && members.includes(previous) ? previous : null;
    },
    (ctx, id: string | null) => ctx.setSelf(id),
  );
  const selection = Atom.readable((get): Selection | null => {
    const id = get(selected);
    const value = get(graph);
    const item = id === null ? undefined : value.get(id);
    const trace = item && value.trace(item.id);
    return item && trace ? { item, graph: value, ...trace } : null;
  });
  const layout = Atom.readable((get) => {
    const sources = get(cells);
    const order = get(ids);
    return new Map(
      order.map((id, index) => [
        id,
        {
          index,
          startsColumn:
            index > 0 &&
            (sources?.get(id)?.config.column ?? 0) !==
              (sources?.get(order[index - 1])?.config.column ?? 0),
        },
      ]),
    );
  });
  const executions = Atom.map(value, (state) => state?.executions ?? {});
  const runtime = Atom.map(value, (state) => state?.runtime?.id);
  const byCell = Atom.readable((get) => {
    const current = new Map<string, typeof Protocol.Execution.Type>();
    const runtimeId = get(runtime);
    for (const execution of Object.values(get(executions))) {
      if (execution.cell_id !== null && execution.runtime_id === runtimeId)
        current.set(execution.cell_id, execution);
    }
    return current;
  });
  const source = Atom.family((id: string) =>
    Atom.map(cells, (cells) => cells?.get(id)),
  );
  const execution = Atom.family((id: string) =>
    Atom.map(byCell, (entries) => entries.get(id)),
  );

  const row = Atom.family((id: string) =>
    Atom.readable((get): Row | null => {
      const cell = get(source(id));
      const value = get(graph);
      const item = value.get(id);
      const position = get(layout).get(id);
      if (!cell || !item || !position) return null;
      const active = get(selection);
      const upstream = active?.upstream.has(id) ?? false;
      const downstream = active?.downstream.has(id) ?? false;
      const parents = value.dependencies(id);
      const children = value.dependents(id);
      const directParent = active !== null && children.has(active.item.id);
      const directChild = active !== null && parents.has(active.item.id);
      const direct = directParent || directChild;
      const work = get(execution(id));
      const currentWork =
        work?.code_fingerprint === cell.code_fingerprint ? work : undefined;
      const error =
        get(currentAnalysis)?.cells[id]?.diagnostics.find((d) => d.severity === "error")
          ?.message ??
        (currentWork?.state.status === "completed" &&
        currentWork.state.outcome.kind === "failed"
          ? currentWork.state.outcome.error.message
          : undefined);
      const relation =
        active?.item.id === id
          ? "selected"
          : upstream && downstream
            ? "cycle"
            : upstream
              ? "upstream"
              : downstream
                ? "downstream"
                : "unrelated";
      return {
        source: cell,
        cell: {
          ...cell,
          definitions: item.definitions,
          references: item.references,
          highlighted: new Set(
            item.definitions.filter(
              (name) =>
                directChild || (directParent && active.item.references.includes(name)),
            ),
          ),
          relation,
          direct,
          error,
          activity:
            currentWork?.state.status === "running"
              ? "Running"
              : currentWork?.state.status === "queued"
                ? "Queued"
                : cell.config.disabled
                  ? "Disabled"
                  : null,
        },
        ...position,
        x: CENTER + (upstream === downstream ? 0 : upstream ? -14 : 14),
        // Direct connections already supply the inward arm.
        leftArm: active ? relation === "downstream" && !direct : parents.size > 0,
        rightArm: active ? relation === "upstream" && !direct : children.size > 0,
        referenceable:
          parents.size > 0 || children.size > 0 || item.definitions.length > 0,
      };
    }).pipe(Atom.withEquality(sameRow)),
  );

  return { ids, selected, selection, row };
}

function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((value, i) => value === b[i]));
}

function sameTopology(a: Topology, b: Topology): boolean {
  return (
    a.current === b.current &&
    a.items.length === b.items.length &&
    a.items.every(
      (item, i) =>
        item.id === b.items[i].id &&
        sameArray(item.definitions, b.items[i].definitions) &&
        sameArray(item.references, b.items[i].references) &&
        sameArray(item.parents, b.items[i].parents),
    )
  );
}

function sameRow(a: Row | null, b: Row | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.source === b.source &&
    a.index === b.index &&
    a.startsColumn === b.startsColumn &&
    a.x === b.x &&
    a.leftArm === b.leftArm &&
    a.rightArm === b.rightArm &&
    a.referenceable === b.referenceable &&
    a.cell.relation === b.cell.relation &&
    a.cell.direct === b.cell.direct &&
    a.cell.error === b.cell.error &&
    a.cell.activity === b.cell.activity &&
    sameArray(a.cell.definitions, b.cell.definitions) &&
    sameArray(a.cell.references, b.cell.references) &&
    a.cell.highlighted.size === b.cell.highlighted.size &&
    [...a.cell.highlighted].every((name) => b.cell.highlighted.has(name))
  );
}
