import * as React from "react";
import type * as Graph from "./graph.ts";
import { caption, labelOrder } from "./GraphView.tsx";
import { formatValue, labelColor, reference } from "./format.ts";

/** Tables of a query's nodes, relationships, or raw records. */
export function ResultTables({
  table,
  result,
  selected,
  onSelect,
}: {
  table: "nodes" | "relationships" | "records";
  result: Graph.Result;
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const nodes = React.useMemo(
    () => new Map(result.nodes.map((node) => [node.id, node])),
    [result.nodes],
  );
  const labels = React.useMemo(() => labelOrder(result.nodes), [result.nodes]);
  const row = (id: string) => ({
    "aria-selected": id === selected,
    onClick: () => onSelect(id === selected ? undefined : id),
  });
  const nodeChip = (id: string) => {
    const node = nodes.get(id);
    if (!node) return <code>{id}</code>;
    return (
      <span className="cypher-chip" title={id}>
        <i style={{ background: labelColor(labels.indexOf(node.labels[0] ?? "")) }} />
        {caption(node) || node.labels.join(":")}
      </span>
    );
  };

  if (table === "nodes") {
    const keys = propertyKeys(result.nodes);
    return (
      <Table columns={["Labels", ...keys]} empty="No nodes.">
        {result.nodes.map((node) => (
          <tr key={node.id} {...row(node.id)}>
            <td>{nodeChip(node.id)}</td>
            {keys.map((key) => (
              <td key={key}>{cell(node.properties[key])}</td>
            ))}
          </tr>
        ))}
      </Table>
    );
  }

  if (table === "relationships") {
    const keys = propertyKeys(result.relationships);
    return (
      <Table columns={["From", "Type", "To", ...keys]} empty="No relationships.">
        {result.relationships.map((relationship) => (
          <tr key={relationship.id} {...row(relationship.id)}>
            <td>{nodeChip(relationship.start)}</td>
            <td>
              <code>:{relationship.type}</code>
            </td>
            <td>{nodeChip(relationship.end)}</td>
            {keys.map((key) => (
              <td key={key}>{cell(relationship.properties[key])}</td>
            ))}
          </tr>
        ))}
      </Table>
    );
  }

  const relationships = new Map(result.relationships.map((entry) => [entry.id, entry]));
  return (
    <Table columns={result.keys} empty="The query returned no records.">
      {result.records.map((record, index) => (
        <tr key={index}>
          {record.map((value, column) => {
            const ref = reference(value);
            if (ref && "$node" in ref)
              return <td key={column}>{nodeChip(ref.$node)}</td>;
            if (ref && "$relationship" in ref) {
              const entry = relationships.get(ref.$relationship);
              return (
                <td key={column}>
                  <code>:{entry?.type ?? ref.$relationship}</code>
                </td>
              );
            }
            if (ref && "$path" in ref) {
              return (
                <td key={column} className="cypher-path">
                  {ref.$path.map((id, step) => (
                    <React.Fragment key={step}>
                      {step > 0 && <span aria-hidden="true">→</span>}
                      {nodeChip(id)}
                    </React.Fragment>
                  ))}
                </td>
              );
            }
            return <td key={column}>{cell(value)}</td>;
          })}
        </tr>
      ))}
    </Table>
  );
}

function Table({
  columns,
  empty,
  children,
}: {
  columns: readonly string[];
  empty: string;
  children: React.ReactNode[];
}) {
  if (children.length === 0) return <p className="notice">{empty}</p>;
  return (
    <div className="cypher-table">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function cell(value: unknown) {
  if (value === undefined) return <span className="cypher-missing">—</span>;
  return formatValue(value);
}

/** Property names across entities, ordered by how often they appear. */
function propertyKeys(
  entities: readonly { readonly properties: Readonly<Record<string, unknown>> }[],
): string[] {
  const counts = new Map<string, number>();
  for (const entity of entities)
    for (const key of Object.keys(entity.properties))
      counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}
