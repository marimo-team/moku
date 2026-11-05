import type { Edge } from "./dependencies.ts";

export const ROW_HEIGHT = 30;
const LANE_SPACING = 24;
export interface ViewGroup {
  id: string;
  label: string;
  members: string[];
}
export interface RailRow {
  id: string;
  members: string[];
  label?: string;
  depth: number;
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
    ids.map((id) => [id, edges.filter((edge) => edge.from === id && indices.has(edge.to))]),
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
      ...forward.filter((edge) => edge.from === id).map((edge) => positions.get(edge.to)!),
    );
    lanes.set(id, lane);
  }
  return { order, lanes, count: Math.max(1, occupiedUntil.length), feedback };
}

function projectedEdges(edges: Edge[], owners: Map<string, string>) {
  const merged = new Map<string, Edge>();
  for (const edge of edges) {
    const from = owners.get(edge.from),
      to = owners.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = JSON.stringify([from, to]);
    merged.set(key, {
      from,
      to,
      names: [...new Set([...(merged.get(key)?.names ?? []), ...edge.names])],
    });
  }
  return [...merged.values()];
}

export function validateGroup(
  groups: ViewGroup[],
  members: string[],
  edges: Edge[],
): string | null {
  const selected = new Set(members);
  if (selected.size < 2) return "Choose at least two cells.";
  for (const group of groups) {
    const overlap = group.members.filter((id) => selected.has(id)).length;
    if (overlap === selected.size && overlap === group.members.length)
      return "These cells already form a group.";
    if (overlap && overlap !== selected.size && overlap !== group.members.length)
      return "Groups must be nested or separate. Include the whole existing group.";
  }
  // Collapsing a group must not conceal a dependency that leaves and re-enters it.
  const outside = edges
    .filter((edge) => selected.has(edge.from) && !selected.has(edge.to))
    .map((edge) => edge.to);
  const seen = new Set<string>();
  while (outside.length) {
    const id = outside.pop()!;
    if (selected.has(id))
      return "Include the intermediate cells so dependencies do not leave and re-enter the group.";
    if (seen.has(id)) continue;
    seen.add(id);
    outside.push(...edges.filter((edge) => edge.from === id).map((edge) => edge.to));
  }
  return null;
}

export function layoutView(
  order: string[],
  edges: Edge[],
  groups: ViewGroup[],
  closed: Set<string>,
) {
  const rows: RailRow[] = [];
  const connections: Array<Edge & { feedback: boolean; returnX: number }> = [];
  const available = new Set(order);
  const validGroups: ViewGroup[] = [];
  for (const group of groups) {
    const members = [...new Set(group.members.filter((id) => available.has(id)))];
    if (!validateGroup(validGroups, members, edges)) validGroups.push({ ...group, members });
  }
  function scope(members: string[], candidates: ViewGroup[], depth: number, originX: number) {
    const roots = candidates.filter(
      (group) =>
        !candidates.some(
          (parent) => parent !== group && group.members.every((id) => parent.members.includes(id)),
        ),
    );
    const owners = new Map(
      members.map((id) => [id, roots.find((group) => group.members.includes(id))?.id ?? id]),
    );
    const ids = [...new Set(members.map((id) => owners.get(id)!))];
    const localEdges = projectedEdges(edges, owners);
    const placement = layoutGraph(ids, localEdges);
    const width = Math.max(40, 26 + (placement.count - 1) * LANE_SPACING);
    const labelX = originX + width + 16;
    const returnX = originX - 8;
    for (const edge of localEdges)
      connections.push({
        ...edge,
        feedback: placement.feedback.has(edge),
        returnX,
      });
    for (const id of placement.order) {
      const group = roots.find((group) => group.id === id);
      rows.push({
        id,
        members: group?.members ?? [id],
        label: group?.label,
        depth,
        x: originX + width - 6 - placement.lanes.get(id)! * LANE_SPACING,
        labelX,
      });
      if (group && !closed.has(id))
        scope(
          members.filter((member) => group.members.includes(member)),
          candidates.filter(
            (candidate) =>
              candidate !== group &&
              candidate.members.every((member) => group.members.includes(member)),
          ),
          depth + 1,
          labelX - 4,
        );
    }
  }
  scope(order, validGroups, 0, 8);
  const positions = new Map(
    rows.map((row, index) => [row.id, { ...row, y: index * ROW_HEIGHT + ROW_HEIGHT / 2 }]),
  );
  const routes: RailEdge[] = connections.map((edge) => {
    const source = positions.get(edge.from)!,
      target = positions.get(edge.to)!;
    if (edge.feedback) {
      const x = Math.max(3, edge.returnX);
      return {
        ...edge,
        path: `M ${source.x - 7} ${source.y} H ${x} V ${target.y} H ${target.x - 12}`,
        arrow: `M ${target.x - 7} ${target.y} l -5 -3.5 v 7 Z`,
      };
    }
    if (source.x === target.x)
      return {
        ...edge,
        path: `M ${source.x} ${source.y + 7} V ${target.y - 12}`,
        arrow: `M ${target.x} ${target.y - 7} l -3.5 -5 h 7 Z`,
      };
    const direction = Math.sign(target.x - source.x);
    const tip = target.x - direction * 7;
    const stem = tip - direction * 5;
    const radius = Math.max(0, Math.min(8, Math.abs(stem - source.x) - 4));
    return {
      ...edge,
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
