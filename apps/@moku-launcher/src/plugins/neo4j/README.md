# Neo4j

The Neo4j view edits neo4j driver calls as Cypher and draws their results as a graph with node, relationship, and record tables.

A Cypher cell is stored as one assignment from `execute_query` on a driver variable, followed by the widget that displays the result, wrapped with `mo.ui.anywidget` so other cells can react to it. The notebook remains plain Python that stock marimo can run.

```python
_result = driver.execute_query(
    """
    MATCH path = (:Person)-[:ACTED_IN]->(:Movie)
    RETURN path
    """,
    database_="neo4j",
)
_result_graph = mo.ui.anywidget(CypherGraph(_result, driver))
_result_graph
```

The view shows such a cell as only its query, keeps the driver, extra arguments, and leading comments, and writes the query back exactly as typed. Cells that display `CypherGraph(_result, driver)` without binding it, as earlier versions wrote them, are edited the same way and keep that form. Other cells render with the Notebook view's cell component.

## Using results in Python

The header of a Cypher cell has a field for the result's name, much like the output name of a marimo SQL cell. New cells start with `_result`, which marimo keeps local to the cell because of its leading underscore, so any number of Cypher cells can coexist. Give the result a public name to use it elsewhere. It is the driver's `EagerResult`, whose `records` are a list of `neo4j.Record` rows, whose `summary` holds timings and counters, and whose `keys` are the column names. A DataFrame is one line away in another cell, although `Record.data()` turns nodes and relationships into their properties.

```python
import polars as pl

pl.DataFrame([record.data() for record in directors.records])
```

The result never changes after the query runs, so it describes what the code asked for. What is on screen, including neighbors added by expanding, is the widget's instead. A cell with a public result also binds its widget to that name with `_graph` appended, whose `nodes` and `relationships` are the drawn `neo4j.graph.Node` and `Relationship` objects. Because marimo tracks the widget, cells that read them rerun after every expansion.

```python
[node["title"] for node in directors_graph.nodes if "Movie" in node.labels]
```

## Exploring and completing

The widget receives the driver so that double-clicking a node can add its neighbors to the drawing. They are read with a fixed, parameterized query routed to readers on the database the result came from, and they change only the drawing and the widget's `nodes` and `relationships`, so the result and its records stay as the query returned them. Expanding needs a running kernel, so it is unavailable in exported HTML.

Once the cell that defines the driver has run, the editor reads the database's labels, relationship types, and property keys through a scratch execution that binds nothing, and completes them after `:` in node and relationship patterns, after `.`, and as map keys. Every Cypher cell on the same driver shares one read, which repeats when the driver is redefined. [wigglystuff's](https://github.com/koaning/wigglystuff) `Neo4jWidget` inspired both.

## Interpolation

As in marimo's SQL cells, a query can interpolate Python, which makes it react to UI elements and other variables.

```cypher
MATCH (p:Person {name: "{actor.value}"})-[:ACTED_IN]->(m:Movie)
RETURN p, m
LIMIT {limit.value}
```

The cell is then stored as an f-string, with the Cypher map's braces doubled. A brace followed by `}`, `.`, or a `key:` pair opens a Cypher map, as in `{}`, `{.name}`, or `{name: ...}`. Any other brace pair around a valid Python expression is an interpolation, which the editor highlights. Interpolated values are pasted into the query text, so quote strings yourself, and pass untrusted input through `parameters_` with `$name` placeholders instead.

## The widget cell

`CypherGraph` is an [anywidget](https://anywidget.dev) defined by a generated cell that the view adds once per notebook, together with the first Cypher or connection cell. The cell inlines the widget's bundled script and styles, so the graph renders wherever the notebook runs, including stock marimo, app mode, and HTML exports, with `anywidget` as its only extra dependency. The view shows the cell as a single line and offers to update it when the notebook carries an older version.

The widget's sources live in [`widget`](widget). The Vite plugin in [`vite.ts`](widget/vite.ts) bundles [`render.ts`](widget/render.ts) with d3-force and [`style.css`](widget/style.css) and inlines the result into the Python class in [`widget.py`](widget/widget.py). The styles are applied by a `style` element inside the widget rather than anywidget's `_css`, which marimo can drop when it recopies page styles on a theme change. The plugin names each generation by a hash of its content. To change the widget, edit those sources and update the cell from the view.

## Example

[`neo4j_movies.py`](../../../../../notebooks/neo4j_movies.py) queries Neo4j's public, read-only movies database at `neo4j+s://demo.neo4jlabs.com`, so it works without a local server. Set `NEO4J_URI`, `NEO4J_USER`, and `NEO4J_PASSWORD` before `bun dev` to use your own database instead. The **Add connection cell** button inserts the same connection.
