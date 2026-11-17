import * as Vitest from "vite-plus/test";
import * as Graph from "../../src/plugins/neo4j/graph.ts";

// Printed by Graph.serializer for `MATCH p=(a)-[r:ACTED_IN]->(m) RETURN p, a, r, m, date(), 0.0/0.0`.
const paths = `__moku_neo4j__:{"nodes": [{"id": "4:x:0", "labels": ["Person"], "properties": {"born": 1964, "name": "Keanu Reeves"}}, {"id": "4:x:1", "labels": ["Movie"], "properties": {"title": "The Matrix", "released": 1999}}], "relationships": [{"id": "5:x:0", "type": "ACTED_IN", "start": "4:x:0", "end": "4:x:1", "properties": {"roles": ["Neo"]}}], "keys": ["p", "a", "r", "m", "today", "nan"], "records": [[{"$path": ["4:x:0", "4:x:1"]}, {"$node": "4:x:0"}, {"$relationship": "5:x:0"}, {"$node": "4:x:1"}, "2026-11-17", "nan"]], "truncated": false}`;

Vitest.test("parses nodes, relationships, and records", () => {
  const result = Graph.parse(`starting\n${paths}\n`);
  Vitest.expect(result.nodes.map((node) => node.properties)).toEqual([
    { born: 1964, name: "Keanu Reeves" },
    { title: "The Matrix", released: 1999 },
  ]);
  Vitest.expect(result.relationships).toEqual([
    {
      id: "5:x:0",
      type: "ACTED_IN",
      start: "4:x:0",
      end: "4:x:1",
      properties: { roles: ["Neo"] },
    },
  ]);
  Vitest.expect(result.keys).toEqual(["p", "a", "r", "m", "today", "nan"]);
  Vitest.expect(result.records[0]?.[0]).toEqual({ $path: ["4:x:0", "4:x:1"] });
});

Vitest.test("parses record-only results", () => {
  const result = Graph.parse(
    '__moku_neo4j__:{"nodes": [], "relationships": [], "keys": ["title", "year"], "records": [["The Matrix", 1999]], "truncated": true}',
  );
  Vitest.expect(result).toEqual({
    nodes: [],
    relationships: [],
    keys: ["title", "year"],
    records: [["The Matrix", 1999]],
    truncated: true,
  });
});

Vitest.test("reports runtime errors and unreadable output", () => {
  Vitest.expect(() =>
    Graph.parse('__moku_neo4j__:{"error": "TypeError: Expected a neo4j EagerResult"}'),
  ).toThrow("TypeError: Expected a neo4j EagerResult");
  Vitest.expect(() => Graph.parse("")).toThrow("no Neo4j result");
  Vitest.expect(() => Graph.parse('__moku_neo4j__:{"nodes": 3}')).toThrow("unreadable");
});

Vitest.test("serializes only public variables", () => {
  Vitest.expect(Graph.serializer("movies")).toContain("__moku_neo4j(movies)");
  Vitest.expect(() => Graph.serializer("_movies")).toThrow();
  Vitest.expect(() => Graph.serializer("movies); import os; (")).toThrow();
});
