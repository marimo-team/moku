export interface Item {
  readonly id: string;
  readonly definitions: readonly string[];
  readonly references: readonly string[];
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
    const definitions = new Map<string, string[]>();
    for (const item of items) {
      this.#parents.set(item.id, new Set());
      this.#children.set(item.id, new Set());
      for (const name of item.definitions) {
        const owners = definitions.get(name) ?? [];
        owners.push(item.id);
        definitions.set(name, owners);
      }
    }
    for (const item of items) {
      for (const name of item.references) {
        for (const owner of definitions.get(name) ?? []) {
          // Reading a name defined by the same cell is not an inter-cell edge.
          if (owner === item.id) continue;
          this.#parents.get(item.id)?.add(owner);
          this.#children.get(owner)?.add(item.id);
        }
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
