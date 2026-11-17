import * as React from "react";
import * as D3Force from "d3-force";
import type * as Graph from "./graph.ts";
import { formatValue, labelColor } from "./format.ts";

interface SimNode extends D3Force.SimulationNodeDatum {
  readonly node: Graph.Node;
}
interface SimLink extends D3Force.SimulationLinkDatum<SimNode> {
  readonly relationship: Graph.Relationship;
  /** Offset for parallel relationships between the same pair of nodes. */
  readonly bend: number;
}

const height = 500;
const radius = 18;

/** A force-directed drawing of a query's nodes and relationships. */
export function GraphView({
  result,
  selected,
  onSelect,
}: {
  result: Graph.Result;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const width = useWidth(container);
  const [, setFrame] = React.useState(0);
  const [view, setView] = React.useState({ x: 0, y: 0, k: 1 });
  const labels = React.useMemo(() => labelOrder(result.nodes), [result.nodes]);

  const simulation = React.useMemo(() => {
    const nodes: SimNode[] = result.nodes.map((node) => ({ node }));
    const index = new Map(nodes.map((entry) => [entry.node.id, entry]));
    const pairs = new Map<string, number>();
    const links: SimLink[] = [];
    for (const relationship of result.relationships) {
      const source = index.get(relationship.start);
      const target = index.get(relationship.end);
      if (!source || !target) continue;
      const pair = [relationship.start, relationship.end].sort().join("\u0000");
      const count = pairs.get(pair) ?? 0;
      pairs.set(pair, count + 1);
      const bend = count === 0 ? 0 : Math.ceil(count / 2) * (count % 2 ? 1 : -1);
      links.push({ source, target, relationship, bend });
    }
    return D3Force.forceSimulation(nodes)
      .force(
        "link",
        D3Force.forceLink<SimNode, SimLink>(links).distance(110).strength(0.6),
      )
      .force("charge", D3Force.forceManyBody().strength(-380))
      .force("collide", D3Force.forceCollide(radius + 8))
      .force("x", D3Force.forceX(0).strength(0.04))
      .force("y", D3Force.forceY(0).strength(0.06))
      .stop();
  }, [result]);

  const widthRef = React.useRef(width);
  widthRef.current = width;
  React.useLayoutEffect(() => {
    // Settle the layout before the first paint and zoom so every node is visible.
    // Later ticks come only from dragging.
    simulation.tick(
      Math.ceil(
        Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()),
      ),
    );
    setView(fit(simulation.nodes(), widthRef.current));
    simulation.on("tick", () => setFrame((frame) => frame + 1));
    return () => {
      simulation.on("tick", null).stop();
    };
  }, [simulation]);

  const nodes = simulation.nodes();
  const links = (
    simulation.force("link") as D3Force.ForceLink<SimNode, SimLink>
  ).links();
  const selectedNode = result.nodes.find((node) => node.id === selected);
  const selectedRelationship = result.relationships.find(
    (relationship) => relationship.id === selected,
  );

  const drag = React.useRef<
    | { kind: "node"; entry: SimNode; moved: boolean }
    | {
        kind: "pan";
        x: number;
        y: number;
        origin: { x: number; y: number };
        moved: boolean;
      }
    | null
  >(null);
  const toGraph = (event: React.PointerEvent) => {
    const box = event.currentTarget.closest("svg")!.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - width / 2 - view.x) / view.k,
      y: (event.clientY - box.top - height / 2 - view.y) / view.k,
    };
  };

  return (
    <div className="cypher-graph" ref={container}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${result.nodes.length} nodes and ${result.relationships.length} relationships`}
        onWheel={(event) => {
          const k = Math.min(4, Math.max(0.2, view.k * Math.exp(-event.deltaY / 400)));
          setView({ ...view, k });
        }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            kind: "pan",
            x: event.clientX,
            y: event.clientY,
            origin: { x: view.x, y: view.y },
            moved: false,
          };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          if (current.kind === "pan") {
            current.moved ||=
              Math.hypot(event.clientX - current.x, event.clientY - current.y) > 3;
            setView({
              ...view,
              x: current.origin.x + event.clientX - current.x,
              y: current.origin.y + event.clientY - current.y,
            });
          } else {
            const point = toGraph(event);
            current.entry.fx = point.x;
            current.entry.fy = point.y;
            current.moved = true;
            simulation.alphaTarget(0.2).restart();
          }
        }}
        onPointerUp={() => {
          const current = drag.current;
          drag.current = null;
          if (current?.kind === "pan") {
            if (!current.moved) onSelect(undefined);
            return;
          }
          if (current?.kind === "node") {
            simulation.alphaTarget(0);
            if (!current.moved) onSelect(current.entry.node.id);
          }
        }}
      >
        <defs>
          <marker
            id="cypher-arrow"
            viewBox="0 0 10 10"
            refX="10"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 10 5 0 10Z" className="cypher-arrowhead" />
          </marker>
        </defs>
        <g
          transform={`translate(${width / 2 + view.x} ${height / 2 + view.y}) scale(${view.k})`}
        >
          {links.map((link) => {
            const source = link.source as SimNode;
            const target = link.target as SimNode;
            const geometry = linkPath(source, target, link.bend);
            const id = link.relationship.id;
            return (
              <g
                key={id}
                className="cypher-link"
                data-selected={id === selected}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onSelect(id)}
              >
                <path d={geometry.path} className="cypher-link-hit" />
                <path d={geometry.path} markerEnd="url(#cypher-arrow)" />
                <text x={geometry.label.x} y={geometry.label.y}>
                  {link.relationship.type}
                </text>
              </g>
            );
          })}
          {nodes.map((entry) => (
            <g
              key={entry.node.id}
              className="cypher-node"
              data-selected={entry.node.id === selected}
              transform={`translate(${entry.x ?? 0} ${entry.y ?? 0})`}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                drag.current = { kind: "node", entry, moved: false };
              }}
            >
              <circle
                r={radius}
                style={{ fill: labelColor(labels.indexOf(entry.node.labels[0] ?? "")) }}
              />
              <text y={radius + 13}>{caption(entry.node)}</text>
              <title>
                {[entry.node.labels.join(":"), caption(entry.node)]
                  .filter(Boolean)
                  .join(" ")}
              </title>
            </g>
          ))}
        </g>
      </svg>
      <div className="cypher-legend">
        {labels.map((label, index) => (
          <span key={label}>
            <i style={{ background: labelColor(index) }} />
            {label || "(no label)"}
          </span>
        ))}
      </div>
      {(selectedNode || selectedRelationship) && (
        <aside className="cypher-details" aria-label="Selection">
          <header>
            {selectedNode
              ? `:${selectedNode.labels.join(":")}`
              : `[:${selectedRelationship!.type}]`}
            <button aria-label="Clear selection" onClick={() => onSelect(undefined)}>
              ×
            </button>
          </header>
          <dl>
            {Object.entries((selectedNode ?? selectedRelationship)!.properties).map(
              ([key, value]) => (
                <React.Fragment key={key}>
                  <dt>{key}</dt>
                  <dd>{formatValue(value)}</dd>
                </React.Fragment>
              ),
            )}
          </dl>
        </aside>
      )}
    </div>
  );
}

/** The display name of a node: `name`, `title`, or its first string property. */
export function caption(node: Graph.Node): string {
  const { name, title } = node.properties;
  if (typeof name === "string") return name;
  if (typeof title === "string") return title;
  const first = Object.values(node.properties).find(
    (value) => typeof value === "string",
  );
  return typeof first === "string" ? first : (node.labels[0] ?? "");
}

/** Labels in order of first appearance, so colors stay stable across renders. */
export function labelOrder(nodes: readonly Graph.Node[]): string[] {
  return [...new Set(nodes.map((node) => node.labels[0] ?? ""))];
}

/** A view transform that centers the nodes and shrinks them to fit, never enlarging. */
function fit(nodes: readonly SimNode[], width: number) {
  if (nodes.length === 0) return { x: 0, y: 0, k: 1 };
  const xs = nodes.map((node) => node.x ?? 0);
  const ys = nodes.map((node) => node.y ?? 0);
  // Leave room for the node radius and the caption below each node.
  const left = Math.min(...xs) - radius - 40;
  const right = Math.max(...xs) + radius + 40;
  const top = Math.min(...ys) - radius - 8;
  const bottom = Math.max(...ys) + radius + 24;
  const k = Math.min(1, (width - 16) / (right - left), (height - 40) / (bottom - top));
  return { x: (-(left + right) / 2) * k, y: (-(top + bottom) / 2) * k - 10, k };
}

function linkPath(source: SimNode, target: SimNode, bend: number) {
  const sx = source.x ?? 0;
  const sy = source.y ?? 0;
  const tx = target.x ?? 0;
  const ty = target.y ?? 0;
  if (source === target) {
    // A self-relationship loops above its node.
    const lift = 46 + Math.abs(bend) * 14;
    return {
      path: `M${sx - 8} ${sy - radius + 2} C${sx - 30} ${sy - lift} ${sx + 30} ${sy - lift} ${sx + 8} ${sy - radius + 2}`,
      label: { x: sx, y: sy - lift + 6 },
    };
  }
  const dx = tx - sx;
  const dy = ty - sy;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const offset = bend * 28;
  const cx = (sx + tx) / 2 + nx * offset;
  const cy = (sy + ty) / 2 + ny * offset;
  // Stop the arrow at the target circle's edge.
  const ex = tx - ((tx - cx) / Math.hypot(tx - cx, ty - cy)) * (radius + 2);
  const ey = ty - ((ty - cy) / Math.hypot(tx - cx, ty - cy)) * (radius + 2);
  return {
    path: `M${sx} ${sy} Q${cx} ${cy} ${ex} ${ey}`,
    label: { x: (sx + 2 * cx + tx) / 4, y: (sy + 2 * cy + ty) / 4 - 4 },
  };
}

function useWidth(container: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = React.useState(720);
  React.useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    setWidth(element.clientWidth || 720);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width || 720);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);
  return width;
}
