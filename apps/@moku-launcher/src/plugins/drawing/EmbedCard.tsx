import { CellOutputs } from "@moku/outputs";
import type * as Notebook from "@moku/core/Notebook";
import * as CoreOutputs from "@moku/core/Outputs";
import * as Outputs from "../notebook/outputs.ts";

export interface EmbedCardProps {
  /** The cell's ID in the current document, or null if no cell has the card's name. */
  readonly cellId: string | null;
  readonly name: string;
  /** The cell's code, shown when `showCode` is on. */
  readonly code: string | null;
  readonly showCode: boolean;
  readonly state: Notebook.State;
  readonly selection: Outputs.Selection;
  readonly onFix: (error: string) => void;
  readonly onRecreate: () => void;
  readonly onRemove: () => void;
}

/** What goes inside a card on the board: the cell's live output, and what to do when it fails. */
export function EmbedCard(props: EmbedCardProps) {
  const { cellId, state, selection } = props;
  if (cellId === null) {
    return (
      <div className="sketcher-card sketcher-card-missing">
        <p>
          The cell <code>{props.name}</code> isn't in the notebook any more.
        </p>
        <div className="sketcher-card-actions">
          <button type="button" onClick={props.onRecreate}>
            Bring it back
          </button>
          <button type="button" onClick={props.onRemove}>
            Remove the card
          </button>
        </div>
      </div>
    );
  }
  const outputs = Outputs.forCell(state, selection, cellId);
  const current = selection.current.get(cellId);
  const busy = current !== undefined && current.state.status !== "completed";
  const error = outputs.outcome?.kind === "failed" ? outputs.outcome.error : null;
  const empty = !CoreOutputs.hasContent(outputs);
  return (
    <div className="sketcher-card" data-busy={busy || undefined}>
      {props.showCode && props.code !== null && (
        <pre className="sketcher-card-code">{props.code}</pre>
      )}
      {busy && empty ? (
        <p className="sketcher-card-note">
          {current?.state.status === "queued" ? "Queued…" : "Running…"}
        </p>
      ) : empty && !error ? (
        <p className="sketcher-card-note">
          {state.runtime?.state.status === "ready" ? "No output." : "Not run yet."}
        </p>
      ) : (
        <CellOutputs {...outputs} />
      )}
      {error && !busy && (
        <div className="sketcher-card-actions">
          <button type="button" onClick={() => props.onFix(describeError(error))}>
            ✦ Fix with Claude
          </button>
        </div>
      )}
    </div>
  );
}

function describeError(error: {
  readonly kind: string;
  readonly message: string;
  readonly name: string | null;
}): string {
  return [error.name, error.kind, error.message].filter(Boolean).join(": ");
}
