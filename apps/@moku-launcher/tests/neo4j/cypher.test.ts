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
)
CypherGraph(movies, driver)`;

const metadata: Cypher.Metadata = {
  variable: "g",
  driver: "driver",
  args: [],
  comments: [],
  graph: false,
};

/** The reactive form, binding the widget to `NAME_graph` so other cells can read it. */
const reactive = `movies = driver.execute_query(
    """
    MATCH (p:Person)-[:ACTED_IN]->(m:Movie)
    RETURN p, m
    """,
)
movies_graph = mo.ui.anywidget(CypherGraph(movies, driver))
movies_graph`;

/** A hand-written Cypher cell around `call`, binding `g`. */
const cell = (call: string, display = "CypherGraph(g, driver)") =>
  `g = ${call}\n${display}`;

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
        graph: false,
      },
    });
  });

  Vitest.test("reads a widget bound for other cells", () => {
    Vitest.expect(Cypher.read(reactive)?.metadata).toEqual({
      variable: "movies",
      driver: "driver",
      args: [],
      comments: [],
      graph: true,
    });
  });

  Vitest.test("removes shared indentation from hand-written queries", () => {
    Vitest.expect(
      Cypher.read(
        cell('driver.execute_query("""\n        MATCH (n)\n          RETURN n""")'),
      )?.cypher,
    ).toBe("MATCH (n)\n  RETURN n");
  });

  Vitest.test("accepts single-line and raw strings", () => {
    Vitest.expect(
      Cypher.read(cell('db.execute_query("RETURN 1")', "CypherGraph(g, db)"))?.cypher,
    ).toBe("RETURN 1");
    Vitest.expect(
      Cypher.read(
        cell(String.raw`db.execute_query(r"""RETURN '\d'""")`, "CypherGraph(g, db)"),
      )?.cypher,
    ).toBe(String.raw`RETURN '\d'`);
  });

  Vitest.test("accepts a private result name", () => {
    Vitest.expect(
      Cypher.read(
        '_result = driver.execute_query("RETURN 1")\nCypherGraph(_result, driver)',
      )?.metadata.variable,
    ).toBe("_result");
  });

  Vitest.test.each([
    [
      "an f-string with an invalid field",
      cell('driver.execute_query(f"""RETURN {x""")'),
    ],
    ["a bytes string", cell('driver.execute_query(b"RETURN 1")')],
    ["a concatenated string", cell('driver.execute_query("RETURN " "1")')],
    ["a query variable", cell("driver.execute_query(query)")],
    ["a keyword query", cell('driver.execute_query(query_="RETURN 1")')],
    ["another method", cell('driver.session("RETURN 1")')],
    ["a nested driver", cell('self.driver.execute_query("RETURN 1")')],
    ["a conditional value", cell('driver.execute_query("RETURN 1") if ok else None')],
    [
      "an unpacked result",
      'g, s, k = driver.execute_query("RETURN 1")\nCypherGraph(g, driver)',
    ],
    [
      "chained assignment",
      'a = g = driver.execute_query("RETURN 1")\nCypherGraph(g, driver)',
    ],
    ["no display", 'g = driver.execute_query("RETURN 1")'],
    ["another display", cell('driver.execute_query("RETURN 1")', "show(g)")],
    [
      "a display of another name",
      cell('driver.execute_query("RETURN 1")', "CypherGraph(h, driver)"),
    ],
    [
      "a display of an expression",
      cell('driver.execute_query("RETURN 1")', "CypherGraph(g, g.keys)"),
    ],
    [
      "a display without the driver",
      cell('driver.execute_query("RETURN 1")', "CypherGraph(g)"),
    ],
    [
      "a display with another driver",
      cell('driver.execute_query("RETURN 1")', "CypherGraph(g, other)"),
    ],
    [
      "trailing code",
      cell('driver.execute_query("RETURN 1")', "CypherGraph(g, driver)\nprint(g)"),
    ],
    ["leading code", `import neo4j\n${cell('driver.execute_query("RETURN 1")')}`],
    [
      "a comment among the arguments",
      cell('driver.execute_query(\n  "RETURN 1",  # c\n)'),
    ],
    [
      "a bound widget under another name",
      cell(
        'driver.execute_query("RETURN 1")',
        "h_graph = mo.ui.anywidget(CypherGraph(g, driver))\nh_graph",
      ),
    ],
    [
      "a bound widget that is not shown",
      cell(
        'driver.execute_query("RETURN 1")',
        "g_graph = mo.ui.anywidget(CypherGraph(g, driver))",
      ),
    ],
    [
      "a bound widget shown by another name",
      cell(
        'driver.execute_query("RETURN 1")',
        "g_graph = mo.ui.anywidget(CypherGraph(g, driver))\ng",
      ),
    ],
    [
      "a widget bound without mo.ui.anywidget",
      cell(
        'driver.execute_query("RETURN 1")',
        "g_graph = CypherGraph(g, driver)\ng_graph",
      ),
    ],
    ["a syntax error", cell('driver.execute_query("RETURN 1"')],
    ["an empty cell", ""],
  ])("rejects %s", (_, code) => {
    Vitest.expect(Cypher.read(code)).toBeUndefined();
  });
});

Vitest.describe("write", () => {
  Vitest.test.each([
    ["a displayed widget", stored],
    ["a bound widget", reactive],
  ])("reproduces stored source with %s", (_, source) => {
    const cell = Cypher.read(source)!;
    Vitest.expect(Cypher.write(cell.cypher, cell.metadata)).toBe(source);
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
    const python = Cypher.write(cypher, metadata);
    Vitest.expect(Cypher.read(python)?.cypher).toBe(cypher);
  });

  Vitest.test("renames the result", () => {
    const cell = Cypher.read(stored)!;
    const python = Cypher.write(cell.cypher, { ...cell.metadata, variable: "actors" });
    Vitest.expect(python).toContain("actors = driver.execute_query(");
    Vitest.expect(python.endsWith("\nCypherGraph(actors, driver)")).toBe(true);
    Vitest.expect(Cypher.read(python)?.cypher).toBe(cell.cypher);
  });

  Vitest.test("renames a bound widget with its result", () => {
    const cell = Cypher.read(reactive)!;
    const python = Cypher.write(cell.cypher, { ...cell.metadata, variable: "actors" });
    Vitest.expect(
      python.endsWith(
        "\nactors_graph = mo.ui.anywidget(CypherGraph(actors, driver))\nactors_graph",
      ),
    ).toBe(true);
    Vitest.expect(Cypher.read(python)?.metadata.variable).toBe("actors");
  });

  Vitest.test(
    "creates an empty cell with a private name that reads back as Cypher",
    () => {
      const python = Cypher.create();
      Vitest.expect(python).toBe(
        '_result = driver.execute_query(\n    """\n\n    """,\n)\n' +
          "_result_graph = mo.ui.anywidget(CypherGraph(_result, driver))\n_result_graph",
      );
      Vitest.expect(Cypher.read(python)).toEqual({
        cypher: "",
        metadata: {
          variable: "_result",
          driver: "driver",
          args: [],
          comments: [],
          graph: true,
        },
      });
    },
  );
});

Vitest.test("accepts Python names that are not keywords", () => {
  Vitest.expect(Cypher.isName("movies")).toBe(true);
  Vitest.expect(Cypher.isName("_movies")).toBe(true);
  Vitest.expect(Cypher.isName("2movies")).toBe(false);
  Vitest.expect(Cypher.isName("class")).toBe(false);
  Vitest.expect(Cypher.isPrivate("_movies")).toBe(true);
  Vitest.expect(Cypher.isPrivate("movies")).toBe(false);
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
    const python = `g = driver.execute_query(
    f"""
    MATCH (p:Person {{name: "{actor.value}"}})
    RETURN p LIMIT {limit.value}
    """,
)
CypherGraph(g, driver)`;
    Vitest.expect(Cypher.read(python)?.cypher).toBe(
      'MATCH (p:Person {name: "{actor.value}"})\nRETURN p LIMIT {limit.value}',
    );
  });

  Vitest.test("writes an f-string only when the query interpolates", () => {
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
    const python = Cypher.write(cypher, metadata);
    Vitest.expect(Cypher.read(python)?.cypher).toBe(cypher);
  });

  Vitest.test("stays valid at every keystroke", () => {
    const target = 'MATCH (p {name: "{actor.value}"}) LIMIT {limit.value}';
    for (let end = 0; end <= target.length; end++) {
      const cypher = target.slice(0, end);
      const python = Cypher.write(cypher, metadata);
      Vitest.expect(Cypher.read(python)?.cypher, cypher).toBe(cypher);
    }
  });
});
