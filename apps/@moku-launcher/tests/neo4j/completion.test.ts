import * as Vitest from "vite-plus/test";
import * as Completion from "../../src/plugins/neo4j/completion.ts";
import * as Neo4jSchema from "../../src/plugins/neo4j/schema.ts";

const schema: Neo4jSchema.Schema = {
  labels: ["Movie", "Person", "Film Star"],
  relationshipTypes: ["ACTED_IN", "DIRECTED"],
  propertyKeys: ["name", "released", "title"],
};

/** Completes at the `|` in `text`. */
const at = (text: string, explicit = false) => {
  const position = text.indexOf("|");
  const result = Completion.complete(text.replace("|", ""), position, schema, explicit);
  return (
    result && {
      from: result.from,
      kinds: [...new Set(result.options.map((o) => o.kind))],
    }
  );
};

Vitest.describe("complete", () => {
  Vitest.test.each([
    ["a label in a node pattern", "MATCH (p:Pe|", 9, "label"],
    ["a label right after the colon", "MATCH (:|", 8, "label"],
    ["a second label", "MATCH (p:Person:|", 16, "label"],
    ["a relationship type", "MATCH (p)-[r:ACT|", 13, "relationship"],
    ["a relationship type after a node", "MATCH (p)-[:|]->(m)", 12, "relationship"],
    ["a property after a dot", "RETURN p.ti|", 9, "property"],
    ["a map key in a pattern", "MATCH (p:Person {na|", 17, "property"],
    ["a second map key", "MATCH (p {name: 'x', ti|", 21, "property"],
    ["a keyword", "MATCH (p) RET|", 10, "keyword"],
  ])("completes %s", (_, text, from, kind) => {
    Vitest.expect(at(text)).toEqual({ from, kinds: [kind] });
  });

  Vitest.test.each([
    ["inside a string", "MATCH (p {name: 'Ke|"],
    ["inside a comment", "MATCH (p) // RET|"],
    ["a map value", "MATCH (p {name:|"],
    ["a decimal point", "RETURN 1.|"],
    ["a single letter", "RETURN p|"],
    ["an empty word", "MATCH (p) |"],
    ["inside a Python interpolation", 'MATCH (p {name: "{actor.va|}"})'],
  ])("offers nothing %s", (_, text) => {
    Vitest.expect(at(text)).toBeUndefined();
  });

  Vitest.test("offers keywords for a short word when asked", () => {
    Vitest.expect(at("MATCH (p) |", true)).toEqual({ from: 10, kinds: ["keyword"] });
  });

  Vitest.test("quotes names that are not identifiers", () => {
    const result = Completion.complete("MATCH (:", 8, schema);
    Vitest.expect(result?.options.find((o) => o.label === "Film Star")?.apply).toBe(
      "`Film Star`",
    );
    Vitest.expect(
      result?.options.find((o) => o.label === "Movie")?.apply,
    ).toBeUndefined();
  });

  Vitest.test("replaces a backtick name being typed", () => {
    Vitest.expect(at("MATCH (:`Fil|")).toEqual({ from: 8, kinds: ["label"] });
  });

  Vitest.test("waits for the schema before completing names", () => {
    Vitest.expect(Completion.complete("MATCH (p:", 9, undefined)).toBeUndefined();
  });
});

Vitest.describe("schema", () => {
  Vitest.test("parses the printed schema", () => {
    Vitest.expect(
      Neo4jSchema.parse(`noise\n__moku_neo4j_schema__:${JSON.stringify(schema)}\n`),
    ).toEqual(schema);
  });

  Vitest.test("reports errors from the runtime", () => {
    Vitest.expect(() =>
      Neo4jSchema.parse('__moku_neo4j_schema__:{"error": "ServiceUnavailable: down"}'),
    ).toThrow("ServiceUnavailable: down");
  });

  Vitest.test("reads only public driver names", () => {
    Vitest.expect(Neo4jSchema.reader("driver")).toContain(
      "__moku_neo4j_schema(driver)",
    );
    Vitest.expect(() => Neo4jSchema.reader("_driver")).toThrow();
  });
});
