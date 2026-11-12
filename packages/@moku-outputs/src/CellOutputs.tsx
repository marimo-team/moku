/**
 * Render an execution's displays, console text, and final outcome together.
 *
 * @module
 */
import type { ReactElement, ReactNode } from "react";
import type { CellOutputsProps, ConsoleChunk, Outcome, OutputItem } from "./types.ts";
import { DisplayView } from "./DisplayView.tsx";
import { ConsoleOutput } from "./ConsoleOutput.tsx";
import "./style.css";

type Group =
  | {
      readonly kind: "display";
      readonly item: Extract<OutputItem, { kind: "display" }>;
    }
  | { readonly kind: "console"; readonly id: string; readonly chunks: ConsoleChunk[] };

function groupItems({ items, outcome }: CellOutputsProps): Group[] {
  const groups: Group[] = [];
  const traceback = outcome?.kind === "error" ? outcome.error.traceback : null;

  for (const item of [...items].sort((a, b) => a.seq - b.seq)) {
    if (item.kind === "display") {
      if (
        traceback?.mimetype === item.content.mimetype &&
        traceback.data === item.content.data
      ) {
        continue;
      }
      groups.push({ kind: "display", item });
      continue;
    }

    const previous = groups.at(-1);
    if (previous?.kind === "console") {
      previous.chunks.push(item);
    } else {
      groups.push({ kind: "console", id: item.id, chunks: [item] });
    }
  }
  return groups;
}

function ErrorView({
  error,
  runtimeId,
}: {
  readonly runtimeId?: string | null;
  readonly error: Extract<Outcome, { kind: "error" }>["error"];
}): ReactElement {
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
}): ReactNode {
  if (outcome === null) {
    return null;
  }
  switch (outcome.kind) {
    case "value":
      return outcome.display ? (
        <DisplayView data={outcome.display} runtimeId={runtimeId} />
      ) : null;
    case "error":
      return <ErrorView error={outcome.error} runtimeId={runtimeId} />;
    case "interrupted":
      return <p className="moku-output-notice">Interrupted</p>;
    case "skipped":
      return <p className="moku-output-notice">{outcome.message}</p>;
  }
}

/**
 * Renders ordered displays and console chunks, followed by the execution outcome.
 *
 * Adjacent console chunks are grouped. A display matching the outcome's
 * traceback is omitted to avoid showing the same traceback twice. Renders
 * nothing when neither the items nor the outcome have visible content.
 *
 * @example Render a selected execution
 * ```tsx
 * import { CellOutputs } from "@moku/outputs";
 * import * as Outputs from "@moku/core/Outputs";
 * import type * as Notebook from "@moku/core/Notebook";
 *
 * function ExecutionOutputs(props: {
 *   snapshot: Notebook.Snapshot;
 *   executionId: string;
 * }) {
 *   const outputs = Outputs.forExecution(props.snapshot, props.executionId);
 *   return <CellOutputs {...outputs} />;
 * }
 * ```
 */
export function CellOutputs(props: CellOutputsProps): ReactElement | null {
  const { outcome, items, className, runtimeId } = props;
  if (
    items.length === 0 &&
    (outcome === null || (outcome.kind === "value" && outcome.display === null))
  ) {
    return null;
  }

  return (
    <div className={["moku-cell-outputs", className].filter(Boolean).join(" ")}>
      {groupItems(props).map((group) =>
        group.kind === "display" ? (
          <DisplayView
            key={`display:${group.item.id}`}
            data={group.item.content}
            runtimeId={runtimeId}
          />
        ) : (
          <ConsoleOutput key={`console:${group.id}`} chunks={group.chunks} />
        ),
      )}
      <OutcomeView outcome={outcome} runtimeId={runtimeId} />
    </div>
  );
}
