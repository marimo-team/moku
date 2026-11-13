import type { Edge } from "./dependencies.ts";

export const ROW_HEIGHT = 30;
const LANE_SPACING = 24;
export interface RailRow {
  id: string;
  x: number;
  labelX: number;
}
export interface RailEdge extends Edge {
  path: string;
  arrow: string;
  feedback: boolean;
}

// A lane stays occupied until all of its node's outgoing edges have arrived.
export function layoutGraph(ids: string[], edges: Edge[]) {
  const indices = new Map(ids.map((id, index) => [id, index]));
  const outgoing = new Map(
    ids.map((id) => [
      id,
      edges.filter((edge) => edge.from === id && indices.has(edge.to)),
    ]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const feedback = new Set<Edge>();
  const finish: string[] = [];
  function visit(id: string) {
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (visiting.has(edge.to)) feedback.add(edge);
      else visit(edge.to);
    }
    visiting.delete(id);
    visited.add(id);
    finish.push(id);
  }
  ids.forEach(visit);
  const forward = edges.filter(
    (edge) => !feedback.has(edge) && indices.has(edge.from) && indices.has(edge.to),
  );
  const depth = new Map(ids.map((id) => [id, 0]));
  for (const id of finish.reverse())
    for (const edge of outgoing.get(id) ?? []) {
      if (!feedback.has(edge))
        depth.set(edge.to, Math.max(depth.get(edge.to)!, depth.get(id)! + 1));
    }
  const components = new Map<string, number>();
  for (const id of ids) {
    if (components.has(id)) continue;
    const first = indices.get(id)!;
    const queue = [id];
    components.set(id, first);
    while (queue.length) {
      const current = queue.pop()!;
      for (const edge of edges) {
        const neighbor =
          edge.from === current ? edge.to : edge.to === current ? edge.from : undefined;
        if (neighbor && indices.has(neighbor) && !components.has(neighbor)) {
          components.set(neighbor, first);
          queue.push(neighbor);
        }
      }
    }
  }
  const order = [...ids].sort(
    (a, b) =>
      components.get(a)! - components.get(b)! ||
      depth.get(a)! - depth.get(b)! ||
      indices.get(a)! - indices.get(b)!,
  );
  const positions = new Map(order.map((id, index) => [id, index]));
  const lanes = new Map<string, number>();
  const occupiedUntil: number[] = [];
  for (const [index, id] of order.entries()) {
    const parents = forward.filter((edge) => edge.to === id);
    const preferred = lanes.get(parents.at(-1)?.from ?? "") ?? 0;
    let lane = -1;
    for (let candidate = 0; candidate < occupiedUntil.length; candidate++) {
      if (occupiedUntil[candidate] > index) continue;
      if (lane < 0 || Math.abs(candidate - preferred) < Math.abs(lane - preferred))
        lane = candidate;
    }
    if (lane < 0) lane = occupiedUntil.length;
    occupiedUntil[lane] = Math.max(
      index,
      ...forward
        .filter((edge) => edge.from === id)
        .map((edge) => positions.get(edge.to)!),
    );
    lanes.set(id, lane);
  }
  return { order, lanes, count: Math.max(1, occupiedUntil.length), feedback };
}

export function layoutView(order: string[], edges: Edge[]) {
  const available = new Set(order);
  const connections = edges.filter(
    (edge) =>
      edge.from !== edge.to && available.has(edge.from) && available.has(edge.to),
  );
  const placement = layoutGraph(order, connections);
  const width = Math.max(40, 26 + (placement.count - 1) * LANE_SPACING);
  const rows: RailRow[] = placement.order.map((id) => ({
    id,
    x: width + 2 - placement.lanes.get(id)! * LANE_SPACING,
    labelX: width + 24,
  }));
  const positions = new Map(
    rows.map((row, index) => [
      row.id,
      { ...row, y: index * ROW_HEIGHT + ROW_HEIGHT / 2 },
    ]),
  );
  const routes: RailEdge[] = connections.map((edge) => {
    const source = positions.get(edge.from)!,
      target = positions.get(edge.to)!;
    const feedback = placement.feedback.has(edge);
    if (feedback) {
      const x = 3;
      return {
        ...edge,
        feedback,
        path: `M ${source.x - 7} ${source.y} H ${x} V ${target.y} H ${target.x - 12}`,
        arrow: `M ${target.x - 7} ${target.y} l -5 -3.5 v 7 Z`,
      };
    }
    if (source.x === target.x)
      return {
        ...edge,
        feedback,
        path: `M ${source.x} ${source.y + 7} V ${target.y - 12}`,
        arrow: `M ${target.x} ${target.y - 7} l -3.5 -5 h 7 Z`,
      };
    const direction = Math.sign(target.x - source.x);
    const tip = target.x - direction * 7;
    const stem = tip - direction * 5;
    const radius = Math.max(0, Math.min(8, Math.abs(stem - source.x) - 4));
    return {
      ...edge,
      feedback,
      path: `M ${source.x} ${source.y + 7} V ${target.y - radius} Q ${source.x} ${target.y} ${source.x + direction * radius} ${target.y} H ${stem}`,
      arrow: `M ${tip} ${target.y} l ${-direction * 5} -3.5 v 7 Z`,
    };
  });
  return {
    rows,
    edges: routes,
    width: Math.max(64, ...rows.map((row) => row.labelX)),
  };
}
