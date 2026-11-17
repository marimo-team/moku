# /// script
# dependencies = ["marimo>=0.25.2", "neo4j>=5"]
# ///

import marimo

__generated_with = "0.25.2"
app = marimo.App()


@app.cell
def _():
    import os
    import neo4j

    # Neo4j's public, read-only movies database; set NEO4J_* to use your own.
    driver = neo4j.GraphDatabase.driver(
        os.environ.get("NEO4J_URI", "neo4j+s://demo.neo4jlabs.com"),
        auth=(
            os.environ.get("NEO4J_USER", "movies"),
            os.environ.get("NEO4J_PASSWORD", "movies"),
        ),
    )
    return (driver,)


@app.cell
def _(driver):
    import marimo as mo

    names = [
        record["name"]
        for record in driver.execute_query(
            "MATCH (p:Person)-[:ACTED_IN]->() RETURN DISTINCT p.name AS name ORDER BY name"
        ).records
    ]
    actor = mo.ui.dropdown(names, value="Keanu Reeves", label="Actor", searchable=True)
    limit = mo.ui.slider(10, 200, value=100, step=10, label="Paths")
    mo.hstack([actor, limit], justify="start", gap=2)
    return actor, limit


@app.cell
def _(actor, driver, limit):
    movies = driver.execute_query(
        f"""
        MATCH path = (:Person {{name: "{actor.value}"}})-[:ACTED_IN]->(:Movie)<-[:ACTED_IN]-(:Person)
                     -[:ACTED_IN]->(:Movie)<-[:ACTED_IN]-(:Person)
        RETURN path
        LIMIT {limit.value}
        """,
    )
    return (movies,)


@app.cell
def _(driver):
    directors = driver.execute_query(
        """
        MATCH (p:Person)-[:DIRECTED]->(m:Movie)
        RETURN p.name AS director, count(m) AS movies, collect(m.title) AS titles
        ORDER BY movies DESC
        LIMIT 10
        """,
    )
    return (directors,)


@app.cell
def _(directors):
    {record["director"]: record["movies"] for record in directors.records}
    return


if __name__ == "__main__":
    app.run()
