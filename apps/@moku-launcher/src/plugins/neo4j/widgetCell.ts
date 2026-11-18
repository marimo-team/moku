/**
 * The generated notebook cell that defines the `CypherGraph` widget.
 *
 * Cypher cells end with `CypherGraph(records, keys)`, so a notebook with Cypher
 * cells carries one copy of this cell. Its source is generated at build time
 * from the widget sources in `widget/`, and its first line names the version,
 * so the view can recognize the cell and offer to replace an older copy.
 *
 * @module
 */
import * as Generated from "virtual:moku-neo4j-widget";

/** Python source of the current widget cell. */
export const source: string = Generated.source;

/** The version of {@link source}. */
export const version: string = Generated.version;

/**
 * Reads the version a cell's code was generated as.
 *
 * Returns undefined when the code is not a generated widget cell.
 */
export function versionOf(code: string): string | undefined {
  if (!code.startsWith(Generated.marker)) return undefined;
  const line = code.slice(Generated.marker.length).split("\n", 1)[0]!.trim();
  return line || undefined;
}

/** Whether a cell's code matches the widget cell this build generates. */
export function isCurrent(code: string): boolean {
  return code.trim() === source.trim();
}
