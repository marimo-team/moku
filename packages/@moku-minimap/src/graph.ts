export interface Item {
  readonly id: string;
  readonly definitions: readonly string[];
  readonly references: readonly string[];
  /** IDs of the cell's direct dependencies. */
  readonly parents: readonly string[];
}

export interface Trace {
  /** Transitive dependencies, excluding the starting item. */
  readonly upstream: ReadonlySet<string>;
  /** Transitive dependents, excluding the starting item. */
  readonly downstream: ReadonlySet<string>;
}

const empty: ReadonlySet<string> = new Set();

/** A directed graph in notebook order. Cycles are allowed. */
export class Graph {
  readonly #items: ReadonlyMap<string, Item>;
  readonly #parents = new Map<string, Set<string>>();
  readonly #children = new Map<string, Set<string>>();
  readonly #traces = new Map<string, Trace>();

  constructor(
    readonly items: readonly Item[],
    /** Whether the dependency analysis matches the current document. */
    readonly current: boolean,
  ) {
    this.#items = new Map(items.map((item) => [item.id, item]));
    for (const item of items) {
      this.#parents.set(item.id, new Set(item.parents));
      for (const parent of item.parents) {
        const children = this.#children.get(parent);
        if (children) children.add(item.id);
        else this.#children.set(parent, new Set([item.id]));
      }
    }
  }

  get(id: string): Item | undefined {
    return this.#items.get(id);
  }

  dependencies(id: string): ReadonlySet<string> {
    return this.#parents.get(id) ?? empty;
  }

  dependents(id: string): ReadonlySet<string> {
    return this.#children.get(id) ?? empty;
  }

  /** Items in both sets participate in a cycle with the starting item. */
  trace(id: string): Trace | undefined {
    if (!this.#items.has(id)) return undefined;
    const cached = this.#traces.get(id);
    if (cached) return cached;
    const trace = {
      upstream: reachable(this.#parents, id),
      downstream: reachable(this.#children, id),
    };
    this.#traces.set(id, trace);
    return trace;
  }
}

function reachable(edges: ReadonlyMap<string, ReadonlySet<string>>, origin: string) {
  const visited = new Set<string>();
  const pending = [origin];
  while (pending.length) {
    const id = pending.pop();
    if (id === undefined || visited.has(id)) continue;
    visited.add(id);
    for (const next of edges.get(id) ?? []) pending.push(next);
  }
  visited.delete(origin);
  return visited;
}
