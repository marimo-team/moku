/**
 * Render an execution's displays, console text, and final outcome together.
 *
 * @module
 */
import type * as React from "react";
import * as Outputs from "@moku/core/Outputs";
import type { CellOutputsProps, Outcome } from "./types.ts";
import { DisplayView } from "./DisplayView.tsx";
import { ConsoleOutput } from "./ConsoleOutput.tsx";
import "./style.css";

function ErrorView({
  error,
  runtimeId,
}: {
  readonly runtimeId?: string | null;
  readonly error: Extract<Outcome, { kind: "failed" }>["error"];
}): React.ReactElement {
  const heading = (
    <span className="moku-error-heading">
      {error.name && <strong>{error.name}</strong>}
      <span>{error.message}</span>
    </span>
  );

  return (
    <div className="moku-error" data-severity={error.severity}>
      {error.traceback ? (
        <details open>
          <summary aria-label={`${error.name ?? "Error"}: ${error.message}`}>
            {heading}
          </summary>
          <div className="moku-traceback">
            <DisplayView data={error.traceback} runtimeId={runtimeId} />
          </div>
        </details>
      ) : (
        heading
      )}
    </div>
  );
}

function OutcomeView({
  outcome,
  runtimeId,
}: {
  readonly outcome: Outcome | null;
  readonly runtimeId?: string | null;
}): React.ReactNode {
  if (outcome === null) {
    return null;
  }
  switch (outcome.kind) {
    case "succeeded":
      return null;
    case "failed":
      return <ErrorView error={outcome.error} runtimeId={runtimeId} />;
    case "cancelled":
      return <p className="moku-output-notice">Cancelled</p>;
    case "skipped":
      return <p className="moku-output-notice">{outcome.message}</p>;
  }
}

/**
 * Renders the console in sequence order, followed by the output and outcome.
 *
 * Adjacent console chunks are grouped. A display matching the outcome's
 * traceback is omitted to avoid showing the same traceback twice.
 *
 * @example Render a selected execution
 * ```tsx
 * import { CellOutputs } from "@moku/outputs";
 * import * as Outputs from "@moku/core/Outputs";
 * import type * as Notebook from "@moku/core/Notebook";
 *
 * function ExecutionOutputs(props: {
 *   snapshot: Notebook.State;
 *   executionId: string;
 * }) {
 *   const outputs = Outputs.forExecution(props.snapshot, props.executionId);
 *   return <CellOutputs {...outputs} />;
 * }
 * ```
 */
export function CellOutputs(props: CellOutputsProps): React.ReactElement | null {
  const { outcome, items, output, className, runtimeId } = props;
  if (!Outputs.hasContent(props)) return null;
  const traceback = outcome?.kind === "failed" ? outcome.error.traceback : null;
  const chunks = traceback
    ? items.filter(
        ({ content }) =>
          content.kind !== "media" ||
          content.media.mimetype !== traceback.mimetype ||
          content.media.data !== traceback.data,
      )
    : items;
  return (
    <div className={["moku-cell-outputs", className].filter(Boolean).join(" ")}>
      <ConsoleOutput chunks={chunks} runtimeId={runtimeId} />
      {output?.media && <DisplayView data={output.media} runtimeId={runtimeId} />}
      <OutcomeView outcome={outcome} runtimeId={runtimeId} />
    </div>
  );
}
