import * as Notebook from "@moku/core/Notebook";
import type { NotebookState } from "../execution.ts";

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
  const order = state.document?.cells.map((cell) => cell.id) ?? [];
  const { analysis } = state;
  if (!analysis) return { order, edges: [], current: false };
  const parents = Notebook.cellParents(analysis);
  const edges = order.flatMap((to) =>
    (parents.get(to) ?? []).map((from) => ({
      from,
      to,
      names: analysis.cells[to].refs.filter((name) =>
        analysis.cells[from]?.defs.includes(name),
      ),
    })),
  );
  const incoming = new Map<string, number>(order.map((id) => [id, 0]));
  for (const edge of edges) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  const remaining = new Set<string>(order);
  const sorted: string[] = [];
  while (remaining.size) {
    const id = order.find((id) => remaining.has(id) && incoming.get(id) === 0);
    if (id === undefined) break;
    remaining.delete(id);
    sorted.push(id);
    for (const edge of edges)
      if (edge.from === id) incoming.set(edge.to, (incoming.get(edge.to) ?? 0) - 1);
  }
  return { order: [...sorted, ...remaining], edges, current: true };
}
