/**
 * The query result the widget's Python serializer sends, and helpers to display it.
 *
 * This module runs inside the notebook's widget bundle, so it avoids
 * dependencies beyond the standard library.
 *
 * @module
 */

/** A node returned by a query, with JSON property values. */
export interface Node {
  readonly id: string;
  readonly labels: readonly string[];
  readonly properties: Readonly<Record<string, unknown>>;
}

/** A relationship returned by a query, including those along returned paths. */
export interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly start: string;
  readonly end: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

/**
 * A query result as a graph and as records.
 *
 * Record values are JSON, with graph entities replaced by references such as
 * `{"$node": id}`, `{"$relationship": id}`, or `{"$path": [ids]}`. Temporal and
 * spatial values arrive as strings.
 */
export interface Result {
  readonly nodes: readonly Node[];
  readonly relationships: readonly Relationship[];
  readonly keys: readonly string[];
  readonly records: readonly (readonly unknown[])[];
  /** Whether records or entities were dropped to keep the payload small. */
  readonly truncated: boolean;
  /** The maximum number of records, nodes, and relationships serialized. */
  readonly limit: number;
  /** Whether the widget has a driver to expand nodes with. */
  readonly expandable?: boolean;
  /** Why the last expansion failed, if it did. */
  readonly error?: string | null;
}

/** A reference the serializer left in a record in place of a graph entity. */
export type Reference =
  | { readonly $node: string }
  | { readonly $relationship: string }
  | { readonly $path: readonly string[] };

// Distinguishable in both themes; labels beyond the palette reuse colors.
const palette = [
  "#4c8eda",
  "#f79767",
  "#57c7e3",
  "#f16667",
  "#8dcc93",
  "#d9c8ae",
  "#c990c0",
  "#ffc454",
  "#da7194",
  "#569480",
];

/** The fill for the label at `index` in first-appearance order. */
export function labelColor(index: number): string {
  return palette[Math.max(0, index) % palette.length]!;
}

/** Labels in order of first appearance, so colors stay stable across renders. */
export function labelOrder(nodes: readonly Node[]): string[] {
  return [...new Set(nodes.map((node) => node.labels[0] ?? ""))];
}

/** The display name of a node: `name`, `title`, or its first string property. */
export function caption(node: Node): string {
  const { name, title } = node.properties;
  if (typeof name === "string") return name;
  if (typeof title === "string") return title;
  const first = Object.values(node.properties).find(
    (value) => typeof value === "string",
  );
  return typeof first === "string" ? first : (node.labels[0] ?? "");
}

/**
 * Renders a JSON record or property value as compact text.
 *
 * Graph references become `{$node: …}`-style text; tables resolve them before
 * calling this.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `[${value.map(formatNested).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${key}: ${formatNested(entry)}`)
      .join(", ")}}`;
  }
  // Remaining JSON values are numbers and booleans.
  return JSON.stringify(value);
}

function formatNested(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : formatValue(value);
}

/** Reads a record value as a graph reference, if it is one. */
export function reference(value: unknown): Reference | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 1) return undefined;
  const entry: unknown = Object.values(value)[0];
  if (keys[0] === "$node" && typeof entry === "string") return { $node: entry };
  if (keys[0] === "$relationship" && typeof entry === "string")
    return { $relationship: entry };
  if (
    keys[0] === "$path" &&
    Array.isArray(entry) &&
    entry.every((id) => typeof id === "string")
  )
    return { $path: entry };
  return undefined;
}

/** Property names across entities, ordered by how often they appear. */
export function propertyKeys(
  entities: readonly { readonly properties: Readonly<Record<string, unknown>> }[],
): string[] {
  const counts = new Map<string, number>();
  for (const entity of entities)
    for (const key of Object.keys(entity.properties))
      counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}
