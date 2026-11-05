import type { NotebookState } from "../notebook/model.ts";

export interface Edge {
  from: string;
  to: string;
  names: string[];
}

export function dependencyGraph(state: NotebookState): {
  order: string[];
  edges: Edge[];
  current: boolean;
} {
  const order = (state.document?.order ?? Object.keys(state.cells)).filter((id) => state.cells[id]);
  const current = state.analysis !== null && state.analysis.document_etag === state.document?.etag;
  if (!current) return { order, edges: [], current };
  const analyses = state.analysis!.cells;
  const definitions = new Map<string, string[]>();
  for (const id of order)
    for (const name of analyses[id]?.defs ?? []) {
      definitions.set(name, [...(definitions.get(name) ?? []), id]);
    }
  const byPair = new Map<string, Edge>();
  for (const to of order)
    for (const name of analyses[to]?.refs ?? []) {
      for (const from of definitions.get(name) ?? []) {
        if (from === to) continue;
        const key = JSON.stringify([from, to]);
        const edge = byPair.get(key) ?? { from, to, names: [] };
        edge.names.push(name);
        byPair.set(key, edge);
      }
    }
  const edges = [...byPair.values()];
  const incoming = new Map(order.map((id) => [id, 0]));
  for (const edge of edges) incoming.set(edge.to, incoming.get(edge.to)! + 1);
  const remaining = new Set(order);
  const sorted: string[] = [];
  while (remaining.size) {
    const id = order.find((id) => remaining.has(id) && incoming.get(id) === 0);
    if (id === undefined) break;
    remaining.delete(id);
    sorted.push(id);
    for (const edge of edges)
      if (edge.from === id) incoming.set(edge.to, incoming.get(edge.to)! - 1);
  }
  return { order: [...sorted, ...remaining], edges, current };
}
