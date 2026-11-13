import * as React from "react";
import { useAtomMount, useAtomSet, useAtomValue } from "@effect/atom-react";
import type * as Notebook from "@moku/core/Notebook";
import * as Model from "./model.ts";
import type { Cell, Selection as SelectionValue } from "./model.ts";

const Context = React.createContext<Model.Model | null>(null);

function useModel() {
  const model = React.useContext(Context);
  if (model === null)
    throw new Error("Minimap sections must be inside <Minimap.Minimap>.");
  return model;
}

export interface Props extends React.ComponentPropsWithoutRef<"section"> {
  readonly notebook: Pick<Notebook.Interface, "state">;
}

export function Minimap({ notebook, className, children, ...props }: Props) {
  const model = React.useMemo(() => Model.make(notebook.state), [notebook.state]);
  useAtomMount(model.selected);
  return (
    <Context.Provider value={model}>
      <section
        aria-label="Notebook minimap"
        {...props}
        className={["moku-minimap", className].filter(Boolean).join(" ")}
      >
        {children}
      </section>
    </Context.Provider>
  );
}

export interface ListProps extends Omit<
  React.ComponentPropsWithoutRef<"div">,
  "children"
> {
  /** Render the row label. The surrounding row is already a toggle button. */
  readonly children: (cell: Cell) => React.ReactNode;
}

export function List({ children, className, onKeyDown, ...props }: ListProps) {
  const model = useModel();
  const ids = useAtomValue(model.ids);
  const active = useAtomValue(model.selected, (id) => id !== null);
  const select = useAtomSet(model.selected);
  return (
    <div
      {...props}
      className={["moku-minimap-scroll", className].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === "Escape") select(null);
      }}
    >
      <div className="moku-minimap-rows" data-selected={active}>
        <svg
          className="moku-minimap-connections"
          width="51"
          height={ids.length * Model.ROW_HEIGHT}
          aria-hidden="true"
        >
          <Connections />
          {ids.map((id) => (
            <Glyph key={id} id={id} />
          ))}
        </svg>
        {ids.map((id) => (
          <Row key={id} id={id}>
            {children}
          </Row>
        ))}
      </div>
    </div>
  );
}

export type Selection = SelectionValue;

export interface SelectionProps {
  /** Rendered only while a cell is selected. */
  readonly children: (
    selection: SelectionValue,
    unselect: () => void,
  ) => React.ReactNode;
}

export function Selection({ children }: SelectionProps) {
  const model = useModel();
  const selection = useAtomValue(model.selection);
  const select = useAtomSet(model.selected);
  const unselect = React.useCallback(() => select(null), [select]);
  return selection === null ? null : children(selection, unselect);
}

const Row = React.memo(function Row({
  id,
  children,
}: {
  id: string;
  children: ListProps["children"];
}) {
  const model = useModel();
  const row = useAtomValue(model.row(id));
  const select = useAtomSet(model.selected);
  if (!row) return null;
  const { cell, index, startsColumn } = row;
  const label = cell.definitions.length
    ? cell.definitions.join(", ")
    : cell.code
        ?.split("\n")
        .find((line) => line.trim())
        ?.trim() || "empty";
  const description = [cell.error, cell.activity].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      className="moku-minimap-row"
      data-index={index}
      data-relation={cell.relation}
      data-direct={cell.direct}
      data-error={!!cell.error}
      data-column-start={startsColumn}
      style={{ height: Model.ROW_HEIGHT }}
      aria-pressed={cell.relation === "selected"}
      aria-label={`Cell ${index}: ${label}${description ? `. ${description}` : ""}`}
      title={cell.error ?? cell.code ?? label}
      onClick={() => select((previous) => (previous === id ? null : id))}
    >
      <span className="moku-minimap-label-background">{children(cell)}</span>
    </button>
  );
});

const Glyph = React.memo(function Glyph({ id }: { id: string }) {
  const row = useAtomValue(useModel().row(id));
  if (!row) return null;
  return (
    <g
      data-cell-id={id}
      transform={`translate(${row.x},${y(row.index)})`}
      data-relation={row.cell.relation}
      data-direct={row.cell.direct}
      data-error={!!row.cell.error}
      data-referenceable={row.referenceable}
    >
      {row.leftArm && <path d="M -8 0 H 0" />}
      {row.rightArm && <path d="M 0 0 H 8" />}
      <circle r={row.referenceable ? 3 : 1.5} />
    </g>
  );
});

function Connections() {
  const selection = useAtomValue(useModel().selection);
  return selection && <SelectedConnections selection={selection} />;
}

function SelectedConnections({ selection }: { selection: SelectionValue }) {
  const { item, graph } = selection;
  const error = useAtomValue(useModel().row(item.id), (row) => !!row?.cell.error);
  const positions = new Map(graph.items.map((item, i) => [item.id, i]));
  const index = positions.get(item.id);
  if (index === undefined) return null;
  const parents = graph.dependencies(item.id);
  const children = graph.dependents(item.id);
  return (
    <g className="moku-minimap-paths" data-error={error}>
      {[...new Set([...parents, ...children])].map((id) => {
        const target = positions.get(id);
        if (target === undefined) return null;
        const parent = parents.has(id);
        const child = children.has(id);
        const side = parent ? -1 : 1;
        const dy = y(target) - y(index);
        return (
          <path
            key={id}
            d={
              parent && child
                ? `M ${Model.CENTER - 3} ${y(index)} h -4 v ${dy} h 14 v ${-dy} h -4`
                : `M ${Model.CENTER + side * 3} ${y(index)} h ${side * 4} v ${dy} h ${side * 4}`
            }
          />
        );
      })}
    </g>
  );
}

function y(index: number) {
  return index * Model.ROW_HEIGHT + Model.ROW_HEIGHT / 2;
}
