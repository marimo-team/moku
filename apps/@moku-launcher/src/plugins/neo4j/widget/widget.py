import anywidget
import traitlets


class CypherGraph(anywidget.AnyWidget):
    """Draws a neo4j query result as a graph with node, relationship, and record tables.

    Pass the `EagerResult` from `driver.execute_query`, a list of records, or a
    `neo4j.graph.Graph`. Only an `EagerResult` knows its columns when the query
    returns no rows.

    With a `driver`, double-clicking a node adds its neighbors to the drawing.
    They are read from the database the result came from, and the records and
    the result itself stay as the query returned them. `nodes` and
    `relationships` follow the drawing instead, so wrapping the widget in
    `mo.ui.anywidget` lets other cells rerun with each expansion:

        movies_graph = mo.ui.anywidget(CypherGraph(movies, driver))
        movies_graph.nodes  # in another cell
    """

    _esm = __MOKU_ESM__
    data = traitlets.Dict().tag(sync=True)
    _expand = traitlets.Dict().tag(sync=True)

    limit = 2000
    """The maximum number of records, nodes, and relationships sent to the browser."""

    neighbors = 100
    """The maximum number of relationships one expansion adds."""

    def __init__(self, result, driver=None):
        self._driver = driver
        summary = getattr(result, "summary", None)
        self._database = getattr(summary, "database", None)
        # The neo4j objects behind the drawing, by element id.
        self._entities = {}
        data = CypherGraph.serialize(result, self._entities)
        data["expandable"] = driver is not None
        super().__init__(data=data)

    @traitlets.observe("_expand")
    def _on_expand(self, change):
        element_id = (change["new"] or {}).get("id")
        if not element_id or self._driver is None:
            return
        import neo4j

        data = dict(self.data)
        # Always change the data, so the browser redraws even when nothing is added.
        data["expansions"] = data.get("expansions", 0) + 1
        try:
            graph = self._driver.execute_query(
                "MATCH (n)-[r]-(m) WHERE elementId(n) = $id RETURN n, r, m LIMIT $limit",
                parameters_={"id": element_id, "limit": CypherGraph.neighbors},
                database_=self._database,
                routing_=neo4j.RoutingControl.READ,
                result_transformer_=neo4j.Result.graph,
            )
        except Exception as error:
            data["error"] = f"Could not expand: {error}"
            self.data = data
            return
        found = {}
        added = CypherGraph.serialize(graph, found)
        data["error"] = None
        for key in ("nodes", "relationships"):
            known = {entry["id"] for entry in data[key]}
            entries = list(data[key])
            for entry in added[key]:
                if entry["id"] in known:
                    continue
                if len(entries) >= CypherGraph.limit:
                    data["truncated"] = True
                    break
                entries.append(entry)
                known.add(entry["id"])
                self._entities[entry["id"]] = found[entry["id"]]
            data[key] = entries
        node_ids = {entry["id"] for entry in data["nodes"]}
        data["relationships"] = [
            entry
            for entry in data["relationships"]
            if entry["start"] in node_ids and entry["end"] in node_ids
        ]
        self.data = data

    @property
    def nodes(self):
        """The `neo4j.graph.Node` objects drawn, including those added by expanding."""
        return [self._entities[entry["id"]] for entry in self.data["nodes"]]

    @property
    def relationships(self):
        """The `neo4j.graph.Relationship` objects drawn, including those added by expanding."""
        return [self._entities[entry["id"]] for entry in self.data["relationships"]]

    @staticmethod
    def serialize(result, entities=None):
        """Converts a result to JSON, replacing graph entities in records with references.

        When given, `entities` receives each drawn node and relationship by element id.
        """
        import math

        from neo4j.graph import Graph, Node, Path, Relationship

        limit = CypherGraph.limit
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
            if entities is not None:
                entities[node.element_id] = node
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
            if entities is not None:
                entities[relationship.element_id] = relationship
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

        columns, records = [], []
        if isinstance(result, Graph):
            for node in result.nodes:
                add_node(node)
            for relationship in result.relationships:
                add_relationship(relationship)
        else:
            rows = getattr(result, "records", result)
            columns = list(getattr(result, "keys", None) or [])
            if not isinstance(rows, (list, tuple)):
                raise TypeError(
                    "Expected neo4j records, an EagerResult, or a Graph, "
                    f"not {type(result).__name__}."
                )
            for index, record in enumerate(rows):
                if index >= limit:
                    truncated = True
                    break
                if not columns:
                    columns = list(record.keys())
                records.append([value(entry) for entry in record.values()])

        return {
            "nodes": list(nodes.values()),
            "relationships": list(relationships.values()),
            "keys": columns,
            "records": records,
            "truncated": truncated,
            "limit": limit,
        }
