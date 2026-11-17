# Neo4j

The Neo4j view edits neo4j driver calls as Cypher and draws their results as a graph with node, relationship, and record tables.

A Cypher cell is stored as one assignment from `execute_query` on a driver variable, so the notebook remains plain Python that stock marimo can run.

```python
movies = driver.execute_query(
    """
    MATCH path = (:Person)-[:ACTED_IN]->(:Movie)
    RETURN path
    """,
    database_="neo4j",
)
```

The view shows such a cell as only its query, keeps the variable name, driver, extra arguments, and leading comments, and writes the query back exactly as typed. Other cells render with the Notebook view's cell component. The bound variable must be public, since marimo keeps underscore names local to their cell.

As in marimo's SQL cells, a query can interpolate Python, which makes it react to UI elements and other variables.

```cypher
MATCH (p:Person {name: "{actor.value}"})-[:ACTED_IN]->(m:Movie)
RETURN p, m
LIMIT {limit.value}
```

The cell is then stored as an f-string, with the Cypher map's braces doubled. A brace followed by `}`, `.`, or a `key:` pair opens a Cypher map, as in `{}`, `{.name}`, or `{name: ...}`. Any other brace pair around a valid Python expression is an interpolation, which the editor highlights. Interpolated values are pasted into the query text, so quote strings yourself, and pass untrusted input through `parameters_` with `$name` placeholders instead.

The host protocol reports only a text preview for variables. After a Cypher cell binds its variable, the view runs a scratch execution that walks the driver's result, collects nodes, relationships, and paths, and prints them as one JSON line. Scratch code reads a copy of the notebook's namespace and binds nothing, so this does not rerun the query or affect other cells. Each variable revision is read once and shared while it is displayed.

[`neo4j_movies.py`](../../../../../notebooks/neo4j_movies.py) queries Neo4j's public, read-only movies database at `neo4j+s://demo.neo4jlabs.com`, so it works without a local server. Set `NEO4J_URI`, `NEO4J_USER`, and `NEO4J_PASSWORD` before `bun dev` to use your own database instead. The **Add connection cell** button inserts the same connection.
