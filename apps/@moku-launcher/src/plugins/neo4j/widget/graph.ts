/** A force-directed drawing of a query's nodes and relationships. @module */
import * as D3Force from "d3-force";
import { html, svg } from "./dom.ts";
import * as Result from "./result.ts";

interface SimNode extends D3Force.SimulationNodeDatum {
  readonly node: Result.Node;
  element?: SVGGElement;
}
interface SimLink extends D3Force.SimulationLinkDatum<SimNode> {
  readonly relationship: Result.Relationship;
  /** Offset for parallel relationships between the same pair of nodes. */
  readonly bend: number;
  element?: SVGGElement;
}

const height = 500;
const radius = 18;
// How hot a redraw starts; lower keeps placed nodes closer to where they were.
const reheat = 0.6;
// How far the view moves toward fitting the nodes on each live tick.
const follow = 0.08;
// Two clicks on the same node within this many milliseconds expand it.
const doubleClick = 350;
let instances = 0;

/** Where a drawing's nodes and view were, so a redraw can continue from there. */
export interface Layout {
  readonly positions: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
  readonly view: { readonly x: number; readonly y: number; readonly k: number };
  /** Whether the user has panned or zoomed, which stops automatic refitting. */
  readonly interacted: boolean;
}

/** A mounted graph drawing. */
export interface View {
  readonly element: HTMLElement;
  /** Highlights a node or relationship by id and shows its properties. */
  readonly select: (id: string | undefined) => void;
  /** The current node positions and view, for {@link draw}'s `previous`. */
  readonly layout: () => Layout;
  /** Stops the simulation and disconnects observers. */
  readonly dispose: () => void;
}

/** Callbacks and starting state for {@link draw}. */
export interface Options {
  /** Receives clicks on entities, or `undefined` for clicks on the background. */
  readonly onSelect: (id: string | undefined) => void;
  /** Receives double-clicked node ids; without it, double-clicks only select. */
  readonly onExpand?: (id: string) => void;
  /**
   * The layout of an earlier drawing of the same result.
   *
   * Nodes it placed start where they were and new nodes start beside `focus`,
   * then the simulation runs live so the drawing grows and makes room for them.
   */
  readonly previous?: Layout;
  /** The node whose neighbors were just added. */
  readonly focus?: string;
}

/**
 * Draws `result` as a force-directed graph.
 *
 * The first layout settles before the first paint and zooms out so every node
 * is visible. A redraw with `previous` starts placed nodes where they were and
 * new ones beside `focus`, which stays pinned, then runs the simulation live so
 * new nodes spread out and the rest shift to make room. The view follows the
 * nodes unless the user has panned or zoomed. Later ticks come from dragging.
 */
export function draw(
  result: Result.Result,
  { onSelect, onExpand, previous, focus }: Options,
): View {
  // Several widgets can share a document, so marker ids must be unique.
  const arrow = `cypher-arrow-${++instances}`;
  const labels = Result.labelOrder(result.nodes);
  const origin = (focus && previous?.positions.get(focus)) || { x: 0, y: 0 };
  const entering = new Set<string>();
  const nodes: SimNode[] = result.nodes.map((node, index) => {
    const known = previous?.positions.get(node.id);
    // The expanded node holds still so the drawing grows around it.
    if (known && node.id === focus)
      return { node, x: known.x, y: known.y, fx: known.x, fy: known.y };
    if (known) return { node, x: known.x, y: known.y };
    if (!previous) return { node };
    entering.add(node.id);
    // Start on a small ring around the origin so the forces can separate them.
    const angle = index * 2.399963;
    return {
      node,
      x: origin.x + 24 * Math.cos(angle),
      y: origin.y + 24 * Math.sin(angle),
    };
  });
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
  const simulation = D3Force.forceSimulation(nodes)
    .force(
      "link",
      D3Force.forceLink<SimNode, SimLink>(links).distance(110).strength(0.6),
    )
    .force("charge", D3Force.forceManyBody().strength(-380))
    .force("collide", D3Force.forceCollide(radius + 8))
    .force("x", D3Force.forceX(0).strength(0.04))
    .force("y", D3Force.forceY(0).strength(0.06))
    .stop();
  // The first drawing settles before painting; a redraw settles live below.
  if (!previous)
    simulation.tick(
      Math.ceil(
        Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()),
      ),
    );
  // Whether the simulation is settling a redraw rather than following a drag.
  let settling = previous !== undefined;

  let width = 720;
  let view = previous?.view ?? { x: 0, y: 0, k: 1 };
  let selected: string | undefined;
  // Refit on resize until the user pans or zooms.
  let interacted = previous?.interacted ?? false;
  let lastClick: { id: string; time: number } | undefined;
  let easing: number | undefined;
  /** Moves the view to `target` over a short ease instead of jumping. */
  const ease = (target: typeof view) => {
    const start = view;
    const begin = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / 450);
      const k = 1 - (1 - t) ** 3;
      view = {
        x: start.x + (target.x - start.x) * k,
        y: start.y + (target.y - start.y) * k,
        k: start.k + (target.k - start.k) * k,
      };
      paint();
      easing = t < 1 ? requestAnimationFrame(step) : undefined;
    };
    if (easing !== undefined) cancelAnimationFrame(easing);
    easing = requestAnimationFrame(step);
  };

  const scene = svg("g");
  for (const link of links) {
    const id = link.relationship.id;
    link.element = svg(
      "g",
      {
        class: "cypher-link",
        "data-id": id,
        "data-entering":
          entering.has(link.relationship.start) || entering.has(link.relationship.end),
      },
      svg("path", { class: "cypher-link-hit" }),
      svg("path", { "marker-end": `url(#${arrow})` }),
      svg("text", {}, link.relationship.type),
    );
    link.element.addEventListener("pointerdown", (event) => event.stopPropagation());
    link.element.addEventListener("click", () => onSelect(id));
    scene.append(link.element);
  }
  for (const entry of nodes) {
    const circle = svg("circle", { r: radius });
    circle.style.fill = Result.labelColor(labels.indexOf(entry.node.labels[0] ?? ""));
    const name = Result.caption(entry.node);
    entry.element = svg(
      "g",
      { class: "cypher-node", "data-entering": entering.has(entry.node.id) },
      circle,
      svg("text", { y: radius + 13 }, name),
      svg("title", {}, [entry.node.labels.join(":"), name].filter(Boolean).join(" ")),
    );
    entry.element.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      canvas.setPointerCapture(event.pointerId);
      drag = { kind: "node", entry, moved: false };
    });
    scene.append(entry.element);
  }

  const canvas = svg(
    "svg",
    {
      height,
      role: "img",
      "aria-label": `${result.nodes.length} nodes and ${result.relationships.length} relationships`,
    },
    svg(
      "defs",
      {},
      svg(
        "marker",
        {
          id: arrow,
          viewBox: "0 0 10 10",
          refX: 10,
          refY: 5,
          markerWidth: 7,
          markerHeight: 7,
          orient: "auto-start-reverse",
        },
        svg("path", { d: "M0 0 10 5 0 10Z", class: "cypher-arrowhead" }),
      ),
    ),
    scene,
  );

  const legend = html(
    "div",
    { class: "cypher-legend" },
    ...labels.map((label, position) => {
      const swatch = html("i");
      swatch.style.background = Result.labelColor(position);
      return html("span", {}, swatch, label || "(no label)");
    }),
    onExpand &&
      html("span", { class: "cypher-hint" }, "Double-click a node to expand it"),
  );
  const details = html("aside", { class: "cypher-details", "aria-label": "Selection" });
  const element = html("div", { class: "cypher-graph" }, canvas, legend, details);

  const paint = () => {
    canvas.setAttribute("width", String(width));
    scene.setAttribute(
      "transform",
      `translate(${width / 2 + view.x} ${height / 2 + view.y}) scale(${view.k})`,
    );
    for (const link of links) {
      const geometry = linkPath(
        link.source as SimNode,
        link.target as SimNode,
        link.bend,
      );
      const [hit, line, label] = link.element!.children;
      hit!.setAttribute("d", geometry.path);
      line!.setAttribute("d", geometry.path);
      label!.setAttribute("x", String(geometry.label.x));
      label!.setAttribute("y", String(geometry.label.y));
    }
    for (const entry of nodes)
      entry.element!.setAttribute(
        "transform",
        `translate(${entry.x ?? 0} ${entry.y ?? 0})`,
      );
  };

  let drag:
    | { kind: "node"; entry: SimNode; moved: boolean }
    | {
        kind: "pan";
        x: number;
        y: number;
        origin: { x: number; y: number };
        moved: boolean;
      }
    | null = null;
  const toGraph = (event: PointerEvent) => {
    const box = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - width / 2 - view.x) / view.k,
      y: (event.clientY - box.top - height / 2 - view.y) / view.k,
    };
  };
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      interacted = true;
      view = {
        ...view,
        k: Math.min(4, Math.max(0.2, view.k * Math.exp(-event.deltaY / 400))),
      };
      paint();
    },
    { passive: false },
  );
  canvas.addEventListener("pointerdown", (event) => {
    if (event.target !== canvas) return;
    canvas.setPointerCapture(event.pointerId);
    drag = {
      kind: "pan",
      x: event.clientX,
      y: event.clientY,
      origin: { x: view.x, y: view.y },
      moved: false,
    };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      drag.moved ||= Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 3;
      interacted ||= drag.moved;
      view = {
        ...view,
        x: drag.origin.x + event.clientX - drag.x,
        y: drag.origin.y + event.clientY - drag.y,
      };
      paint();
    } else {
      const point = toGraph(event);
      drag.entry.fx = point.x;
      drag.entry.fy = point.y;
      drag.moved = true;
      simulation.alphaTarget(0.2).restart();
    }
  });
  canvas.addEventListener("pointerup", () => {
    const current = drag;
    drag = null;
    if (current?.kind === "pan" && !current.moved) onSelect(undefined);
    if (current?.kind === "node") {
      simulation.alphaTarget(0);
      if (current.moved) return;
      const id = current.entry.node.id;
      const now = performance.now();
      // Pointer capture retargets the browser's own dblclick to the canvas.
      if (onExpand && lastClick?.id === id && now - lastClick.time < doubleClick) {
        lastClick = undefined;
        // Pulses until the redraw with the node's neighbors replaces this drawing.
        current.entry.element!.dataset.expanding = "true";
        onExpand(id);
      } else {
        lastClick = { id, time: now };
        onSelect(id);
      }
    }
  });
  simulation.on("tick", () => {
    // Follow the growing drawing instead of jumping to fit it.
    if (settling && !interacted && !drag) {
      const target = fit(nodes, width);
      view = {
        x: view.x + (target.x - view.x) * follow,
        y: view.y + (target.y - view.y) * follow,
        k: view.k + (target.k - view.k) * follow,
      };
    }
    paint();
  });
  simulation.on("end", () => {
    if (!settling) return;
    settling = false;
    const pinned = focus === undefined ? undefined : index.get(focus);
    if (pinned && !(drag?.kind === "node" && drag.entry === pinned))
      pinned.fx = pinned.fy = null;
    if (!interacted) ease(fit(nodes, width));
  });

  const observer = new ResizeObserver(([entry]) => {
    const next = entry?.contentRect.width || 720;
    if (next === width) return;
    width = next;
    if (!interacted) view = fit(nodes, width);
    paint();
  });
  observer.observe(element);
  if (!interacted && !previous) view = fit(nodes, width);
  paint();
  if (previous) simulation.alpha(reheat).restart();

  const select = (id: string | undefined) => {
    selected = id;
    for (const link of links)
      link.element!.dataset.selected = String(link.relationship.id === id);
    for (const entry of nodes)
      entry.element!.dataset.selected = String(entry.node.id === id);
    const node = result.nodes.find((entry) => entry.id === id);
    const relationship = result.relationships.find((entry) => entry.id === id);
    const entity = node ?? relationship;
    details.replaceChildren();
    details.hidden = !entity;
    if (!entity) return;
    const clear = html("button", { "aria-label": "Clear selection" }, "×");
    clear.addEventListener("click", () => onSelect(undefined));
    details.append(
      html(
        "header",
        {},
        node ? `:${node.labels.join(":")}` : `[:${relationship!.type}]`,
        clear,
      ),
      html(
        "dl",
        {},
        ...Object.entries(entity.properties).flatMap(([key, value]) => [
          html("dt", {}, key),
          html("dd", {}, Result.formatValue(value)),
        ]),
      ),
    );
  };
  select(selected);

  return {
    element,
    select,
    layout: () => ({
      positions: new Map(
        nodes.map((entry) => [entry.node.id, { x: entry.x ?? 0, y: entry.y ?? 0 }]),
      ),
      view,
      interacted,
    }),
    dispose: () => {
      simulation.on("tick", null).on("end", null).stop();
      if (easing !== undefined) cancelAnimationFrame(easing);
      observer.disconnect();
    },
  };
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
  const reach = Math.hypot(tx - cx, ty - cy) || 1;
  const ex = tx - ((tx - cx) / reach) * (radius + 2);
  const ey = ty - ((ty - cy) / reach) * (radius + 2);
  return {
    path: `M${sx} ${sy} Q${cx} ${cy} ${ex} ${ey}`,
    label: { x: (sx + 2 * cx + tx) / 4, y: (sy + 2 * cy + ty) / 4 - 4 },
  };
}
