import * as Vitest from "vite-plus/test";
import * as Cypher from "../../src/plugins/neo4j/cypher.ts";

const stored = `# Actors and their movies
movies = driver.execute_query(
    """
    MATCH (p:Person)-[r:ACTED_IN]->(m:Movie {released: 1999})
    RETURN p, r, m
    """,
    database_="neo4j",
    parameters_={"limit": 5},
)`;

Vitest.describe("read", () => {
  Vitest.test("projects the query and preserves the surrounding Python", () => {
    Vitest.expect(Cypher.read(stored)).toEqual({
      cypher:
        "MATCH (p:Person)-[r:ACTED_IN]->(m:Movie {released: 1999})\nRETURN p, r, m",
      metadata: {
        variable: "movies",
        driver: "driver",
        args: ['database_="neo4j"', 'parameters_={"limit": 5}'],
        comments: ["# Actors and their movies"],
      },
    });
  });

  Vitest.test("removes shared indentation from hand-written queries", () => {
    Vitest.expect(
      Cypher.read(
        'g = driver.execute_query("""\n        MATCH (n)\n          RETURN n""")',
      )?.cypher,
    ).toBe("MATCH (n)\n  RETURN n");
  });

  Vitest.test("accepts single-line and raw strings", () => {
    Vitest.expect(Cypher.read('g = db.execute_query("RETURN 1")')?.cypher).toBe(
      "RETURN 1",
    );
    Vitest.expect(
      Cypher.read(String.raw`g = db.execute_query(r"""RETURN '\d'""")`)?.cypher,
    ).toBe(String.raw`RETURN '\d'`);
  });

  Vitest.test.each([
    ["an f-string with an invalid field", 'g = driver.execute_query(f"""RETURN {x""")'],
    ["a bytes string", 'g = driver.execute_query(b"RETURN 1")'],
    ["a concatenated string", 'g = driver.execute_query("RETURN " "1")'],
    ["a query variable", "g = driver.execute_query(query)"],
    ["a keyword query", 'g = driver.execute_query(query_="RETURN 1")'],
    ["another method", 'g = driver.session("RETURN 1")'],
    ["a nested driver", 'g = self.driver.execute_query("RETURN 1")'],
    ["a conditional value", 'g = driver.execute_query("RETURN 1") if ok else None'],
    ["chained assignment", 'a = g = driver.execute_query("RETURN 1")'],
    ["trailing code", 'g = driver.execute_query("RETURN 1")\nprint(g)'],
    ["leading code", 'import neo4j\ng = driver.execute_query("RETURN 1")'],
    [
      "a comment among the arguments",
      'g = driver.execute_query(\n  "RETURN 1",  # c\n)',
    ],
    ["a syntax error", 'g = driver.execute_query("RETURN 1"'],
    ["an empty cell", ""],
  ])("rejects %s", (_, code) => {
    Vitest.expect(Cypher.read(code)).toBeUndefined();
  });
});

Vitest.describe("write", () => {
  Vitest.test("reproduces stored source", () => {
    const cell = Cypher.read(stored)!;
    Vitest.expect(Cypher.write(cell.cypher, cell.metadata)).toBe(stored);
  });

  Vitest.test.each([
    ["triple quotes", 'RETURN """quoted""" AS text'],
    ["backslashes", String.raw`MATCH (n) WHERE n.name =~ '\\d+\n' RETURN n`],
    ["blank lines", "MATCH (n)\n\nRETURN n"],
    ["indentation", "MATCH (n)\nWHERE\n  n.age > 3\nRETURN n"],
    ["a trailing quote", 'RETURN "a"'],
    ["a trailing newline", "MATCH (n)\n"],
    ["a leading blank line", "\nMATCH (n)"],
    ["an indented first line", "  MATCH (n)"],
    ["whitespace-only lines", "MATCH (n)\n  \nRETURN n"],
    ["an empty query", ""],
  ])("round-trips %s", (_, cypher) => {
    const python = Cypher.write(cypher, {
      variable: "g",
      driver: "driver",
      args: [],
      comments: [],
    });
    Vitest.expect(Cypher.read(python)?.cypher).toBe(cypher);
  });

  Vitest.test("creates an empty cell that reads back as Cypher", () => {
    const python = Cypher.create("graph");
    Vitest.expect(python).toBe('graph = driver.execute_query(\n    """\n\n    """,\n)');
    Vitest.expect(Cypher.read(python)).toEqual({
      cypher: "",
      metadata: { variable: "graph", driver: "driver", args: [], comments: [] },
    });
  });
});

Vitest.test("chooses unused variable names", () => {
  Vitest.expect(Cypher.nextVariable([])).toBe("graph");
  Vitest.expect(Cypher.nextVariable(["graph", "graph_2"])).toBe("graph_3");
});

Vitest.test("requires public identifiers", () => {
  Vitest.expect(Cypher.isPublicVariable("movies")).toBe(true);
  Vitest.expect(Cypher.isPublicVariable("_movies")).toBe(false);
  Vitest.expect(Cypher.isPublicVariable("2movies")).toBe(false);
});

Vitest.describe("interpolation", () => {
  Vitest.test("finds Python fields and leaves Cypher maps alone", () => {
    const cypher =
      'MATCH (p:Person {name: "{actor.value}"}) RETURN p {.name, .born} LIMIT {limit.value}';
    Vitest.expect(
      Cypher.interpolations(cypher).map((field) => field.expression),
    ).toEqual(["actor.value", "limit.value"]);
  });

  Vitest.test.each([
    ["an empty map", "RETURN {}"],
    ["a map projection", "RETURN p {.*}"],
    ["a backtick key", "RETURN {`full name`: 1}"],
    ["JSON inside a string", `RETURN '{"a": 1}'`],
    ["an unfinished field", "LIMIT {limit.val"],
    ["an empty field", "LIMIT { }"],
    ["a format spec", "RETURN {x:>3}"],
    ["doubled braces", "RETURN {{x}}"],
  ])("ignores %s", (_, cypher) => {
    const fields = Cypher.interpolations(cypher);
    Vitest.expect(fields.filter((field) => field.expression !== "x")).toEqual([]);
  });

  Vitest.test("reads f-strings as marimo SQL cells do", () => {
    const python = `movies = driver.execute_query(
    f"""
    MATCH (p:Person {{name: "{actor.value}"}})
    RETURN p LIMIT {limit.value}
    """,
)`;
    Vitest.expect(Cypher.read(python)?.cypher).toBe(
      'MATCH (p:Person {name: "{actor.value}"})\nRETURN p LIMIT {limit.value}',
    );
  });

  Vitest.test("writes an f-string only when the query interpolates", () => {
    const metadata = { variable: "g", driver: "driver", args: [], comments: [] };
    Vitest.expect(Cypher.write("RETURN {a: 1}", metadata)).toContain(
      '    """\n    RETURN {a: 1}\n',
    );
    Vitest.expect(Cypher.write("RETURN {a: {x}}", metadata)).toContain(
      '    f"""\n    RETURN {{a: {x}}}\n',
    );
  });

  Vitest.test.each([
    ["a field in a map", "MATCH (p {name: {actor.value}}) RETURN p"],
    ["a field in a string", 'MATCH (p {name: "{actor.value}"}) RETURN p'],
    ["indexing with strings", 'RETURN {row["name"]} AS name, {a: 1} AS m'],
    ["doubled braces", "RETURN {{x}} AS weird"],
    ["backslashes and quotes", String.raw`RETURN "\d" + {x} + '"""'`],
    ["multiple lines", "MATCH (n)\nWHERE n.age > {age.value}\nRETURN n\n"],
  ])("round-trips %s", (_, cypher) => {
    const python = Cypher.write(cypher, {
      variable: "g",
      driver: "driver",
      args: [],
      comments: [],
    });
    Vitest.expect(Cypher.read(python)?.cypher).toBe(cypher);
  });

  Vitest.test("stays valid at every keystroke", () => {
    const target = 'MATCH (p {name: "{actor.value}"}) LIMIT {limit.value}';
    for (let end = 0; end <= target.length; end++) {
      const cypher = target.slice(0, end);
      const python = Cypher.write(cypher, {
        variable: "g",
        driver: "driver",
        args: [],
        comments: [],
      });
      Vitest.expect(Cypher.read(python)?.cypher, cypher).toBe(cypher);
    }
  });
});
