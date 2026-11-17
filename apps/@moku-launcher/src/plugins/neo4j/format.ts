/** Display helpers shared by the graph and table views. @module */
import { Option, Predicate, Schema } from "effect";

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

/**
 * Renders a JSON record or property value as compact text.
 *
 * Graph references from the serializer become `(node)`, `[relationship]`, and
 * `path(n)` placeholders that the tables resolve separately.
 */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Predicate.isString(value)) return value;
  if (Array.isArray(value)) return `[${value.map(formatNested).join(", ")}]`;
  if (Predicate.isObject(value)) {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${key}: ${formatNested(entry)}`)
      .join(", ")}}`;
  }
  // Remaining JSON values are numbers and booleans.
  return JSON.stringify(value);
}

function formatNested(value: unknown): string {
  return Predicate.isString(value) ? JSON.stringify(value) : formatValue(value);
}

const ReferenceSchema = Schema.Union([
  Schema.Struct({ $node: Schema.String }),
  Schema.Struct({ $relationship: Schema.String }),
  Schema.Struct({ $path: Schema.Array(Schema.String) }),
]);

/** A reference the serializer left in a record in place of a graph entity. */
export type Reference = typeof ReferenceSchema.Type;

/** Reads a record value as a graph reference, if it is one. */
export const reference = (value: unknown): Reference | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ReferenceSchema)(value));
