/**
 * Reads a Cypher cell's result from the runtime as nodes, relationships, and records.
 *
 * The host protocol reports only a text preview for variables, so the client
 * runs a scratch execution that serializes the bound result and prints it as
 * one JSON line. Scratch code reads a copy of the notebook's namespace and
 * binds no variables.
 *
 * @module
 */
import { Effect, Exit, Schema } from "effect";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import type * as Notebook from "@moku/core/Notebook";
import * as Outputs from "@moku/core/Outputs";
import * as Cypher from "./cypher.ts";

/** Properties as JSON values; temporal and spatial values arrive as strings. */
const Properties = Schema.Record(Schema.String, Schema.Unknown);

/** A node returned by a query. */
export const Node = Schema.Struct({
  id: Schema.String,
  labels: Schema.Array(Schema.String),
  properties: Properties,
});
export type Node = typeof Node.Type;

/** A relationship returned by a query, including those along returned paths. */
export const Relationship = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  start: Schema.String,
  end: Schema.String,
  properties: Properties,
});
export type Relationship = typeof Relationship.Type;

/**
 * A query result as a graph and as records.
 *
 * Record values are JSON, with graph entities replaced by references such as
 * `{"$node": id}`, `{"$relationship": id}`, or `{"$path": [ids]}`.
 */
export const Result = Schema.Struct({
  nodes: Schema.Array(Node),
  relationships: Schema.Array(Relationship),
  keys: Schema.Array(Schema.String),
  records: Schema.Array(Schema.Array(Schema.Unknown)),
  /** Whether records or entities were dropped to keep the payload small. */
  truncated: Schema.Boolean,
});
export type Result = typeof Result.Type;

const Payload = Schema.fromJsonString(
  Schema.Union([Result, Schema.Struct({ error: Schema.String })]),
);

const marker = "__moku_neo4j__:";

/** The maximum number of records, nodes, and relationships serialized. */
export const limit = 2000;

/**
 * Python that prints `variable`'s result as one marker-prefixed JSON line.
 *
 * Accepts an `EagerResult`, a `neo4j.graph.Graph`, or a list of records.
 */
export function serializer(variable: string): string {
  if (!Cypher.isPublicVariable(variable)) {
    throw new Error(`Cannot read the private or invalid variable ${variable}.`);
  }
  return `
def __moku_neo4j(result):
    import json, math
    from neo4j.graph import Graph, Node, Path, Relationship

    limit = ${limit}
    nodes, relationships, truncated = {}, {}, False

    def scalar(value):
        if value is None or isinstance(value, (bool, int, str)):
            return value
        if isinstance(value, float):
            return value if math.isfinite(value) else str(value)
        if isinstance(value, (list, tuple)):
            return [scalar(item) for item in value]
        if isinstance(value, dict):
            return {str(key): scalar(item) for key, item in value.items()}
        return str(value)

    def add_node(node):
        nonlocal truncated
        if node.element_id in nodes:
            return
        if len(nodes) >= limit:
            truncated = True
            return
        nodes[node.element_id] = {
            "id": node.element_id,
            "labels": sorted(node.labels),
            "properties": scalar(dict(node)),
        }

    def add_relationship(relationship):
        nonlocal truncated
        if relationship.element_id in relationships:
            return
        if len(relationships) >= limit:
            truncated = True
            return
        start, end = relationship.start_node, relationship.end_node
        if start is None or end is None:
            return
        add_node(start)
        add_node(end)
        relationships[relationship.element_id] = {
            "id": relationship.element_id,
            "type": relationship.type,
            "start": start.element_id,
            "end": end.element_id,
            "properties": scalar(dict(relationship)),
        }

    def value(item):
        if isinstance(item, Node):
            add_node(item)
            return {"$node": item.element_id}
        if isinstance(item, Relationship):
            add_relationship(item)
            return {"$relationship": item.element_id}
        if isinstance(item, Path):
            for node in item.nodes:
                add_node(node)
            for relationship in item.relationships:
                add_relationship(relationship)
            return {"$path": [node.element_id for node in item.nodes]}
        if isinstance(item, (list, tuple)):
            return [value(entry) for entry in item]
        if isinstance(item, dict):
            return {str(key): value(entry) for key, entry in item.items()}
        return scalar(item)

    keys, records = [], []
    if isinstance(result, Graph):
        for node in result.nodes:
            add_node(node)
        for relationship in result.relationships:
            add_relationship(relationship)
    else:
        rows = getattr(result, "records", result)
        keys = list(getattr(result, "keys", None) or [])
        if not isinstance(rows, (list, tuple)):
            raise TypeError(
                f"Expected a neo4j EagerResult, Graph, or list of records, not {type(result).__name__}."
            )
        for index, record in enumerate(rows):
            if index >= limit:
                truncated = True
                break
            if not keys:
                keys = list(record.keys())
            records.append([value(entry) for entry in record.values()])

    return {
        "nodes": list(nodes.values()),
        "relationships": list(relationships.values()),
        "keys": keys,
        "records": records,
        "truncated": truncated,
    }

try:
    __moku_payload = __moku_neo4j(${variable})
except Exception as error:
    __moku_payload = {"error": f"{type(error).__name__}: {error}"}
print(${JSON.stringify(marker)} + __import__("json").dumps(__moku_payload, allow_nan=False))
`;
}

/** Parses the printed payload from a scratch execution's standard output. */
export function parse(stdout: string): Result {
  const line = stdout.split("\n").find((line) => line.startsWith(marker));
  if (line === undefined) throw new Error("The runtime returned no Neo4j result.");
  const exit = Schema.decodeUnknownExit(Payload)(line.slice(marker.length));
  if (Exit.isFailure(exit))
    throw new Error("The runtime returned an unreadable result.");
  if ("error" in exit.value) throw new Error(exit.value.error);
  return exit.value;
}

/** Identifies one revision of a Cypher cell's variable. */
export interface Key {
  readonly notebook: Notebook.Interface;
  readonly variable: string;
  /** The variable's revision, so rerunning the cell fetches again. */
  readonly revision: string;
}

/**
 * Loads the result bound to a variable at one revision.
 *
 * Keys compare structurally, and the registry keeps a mounted atom alive, so
 * every render of the same revision shares one fetch.
 *
 * @example
 * ```ts
 * const result = Graph.load({ notebook, variable: "movies", revision: "e12:0" });
 * ```
 */
export const load = Atom.family(({ notebook, variable }: Key) =>
  fetch(notebook, variable),
);

function fetch(notebook: Notebook.Interface, variable: string) {
  return Atom.make(
    Effect.gen(function* () {
      const registry = yield* AtomRegistry.AtomRegistry;
      const run = yield* notebook.runtime.execute({ code: serializer(variable) });
      const stdout = yield* Effect.callback<string, Error>((resume) => {
        const check = (state: AsyncResult.AsyncResult<Notebook.State, unknown>) => {
          if (!AsyncResult.isSuccess(state)) return false;
          const execution = Object.values(state.value.executions).find(
            (execution) => execution.run_id === run.id,
          );
          const finished =
            state.value.runs[run.id]?.status === "completed" ||
            execution?.status === "completed";
          if (!finished) return false;
          if (!execution) {
            resume(Effect.fail(new Error("The runtime did not read the result.")));
            return true;
          }
          if (execution.outcome?.kind === "error") {
            resume(Effect.fail(new Error(execution.outcome.error.message)));
            return true;
          }
          const items = Outputs.forExecution(state.value, execution.id).items;
          resume(
            Effect.succeed(
              items
                .flatMap((item) =>
                  item.kind === "console" && item.name === "stdout" ? [item.text] : [],
                )
                .join(""),
            ),
          );
          return true;
        };
        if (check(registry.get(notebook.state))) return;
        const unsubscribe = registry.subscribe(notebook.state, (state) => {
          if (check(state)) unsubscribe();
        });
        return Effect.sync(unsubscribe);
      });
      return yield* Effect.try({
        try: () => parse(stdout),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      });
    }),
  ).pipe(Atom.setIdleTTL(30_000));
}
