import { useAtomValue } from "@effect/atom-react";
import type * as Notebook from "@moku/core/Notebook";
import * as Minimap from "@moku/minimap";
import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import * as React from "react";

import "@moku/minimap/style.css";

export function NotebookMinimap({ notebook }: Pick<Minimap.Props, "notebook">) {
  const [showNumbers, setShowNumbers] = React.useState(false);
  return (
    <Minimap.Minimap
      notebook={notebook}
      className={showNumbers ? "moku-minimap-with-numbers" : undefined}
    >
      <Notice notebook={notebook} />
      <label className="moku-minimap-number-toggle">
        <input
          type="checkbox"
          checked={showNumbers}
          onChange={(event) => setShowNumbers(event.currentTarget.checked)}
        />
        Show numbers
      </label>
      <Minimap.List>{(cell) => <CellLabel cell={cell} />}</Minimap.List>
      <Minimap.Selection>
        {(selection, unselect) => (
          <div className="moku-minimap-summary">
            <span role="status">
              {selection.graph.current
                ? `${selection.upstream.size} upstream · ${selection.downstream.size} downstream`
                : "Dependencies unavailable"}
            </span>
            <button type="button" onClick={unselect}>
              Unselect
            </button>
          </div>
        )}
      </Minimap.Selection>
    </Minimap.Minimap>
  );
}

function Notice({ notebook }: Pick<Minimap.Props, "notebook">) {
  const message = useAtomValue(notebook.state, notice);
  return (
    message && (
      <p className="moku-minimap-notice" role="status">
        {message}
      </p>
    )
  );
}

function notice(
  result: AsyncResult.AsyncResult<Notebook.State, Notebook.Error>,
): string | null {
  if (AsyncResult.isFailure(result)) {
    const error = Cause.squash(result.cause);
    return error instanceof Error ? error.message : "Connection failed.";
  }
  if (AsyncResult.isInitial(result)) return "Connecting…";
  if (result.waiting) return "Disconnected. Showing the last available notebook.";
  if (result.value.document?.order.length === 0) return "This notebook has no cells.";
  if (!result.value.analysis) return "Waiting for dependency analysis…";
  return null;
}

function CellLabel({ cell }: { cell: Minimap.Cell }) {
  const { definitions } = cell;
  const preview = cell.code
    ?.split("\n")
    .find((line) => line.trim())
    ?.trim();
  return (
    <span className="moku-minimap-label">
      {definitions.length ? (
        definitions.map((name, position) => (
          <React.Fragment key={name}>
            {position > 0 && ", "}
            <span
              className="moku-minimap-variable"
              data-highlighted={cell.highlighted.has(name)}
            >
              {name}
            </span>
          </React.Fragment>
        ))
      ) : (
        <span className="moku-minimap-preview">{preview || <i>empty</i>}</span>
      )}
    </span>
  );
}
