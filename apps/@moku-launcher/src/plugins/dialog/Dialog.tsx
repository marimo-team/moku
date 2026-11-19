import { useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/reactivity";
import type { ViewProps } from "@moku/plugin";
import { NotebookEditor, type Extensions } from "../notebook/NotebookEditor.tsx";
import type * as Model from "../notebook/model.ts";
import { BottomBar } from "./BottomBar.tsx";
import * as Conversation from "./conversation.ts";
import { Progress } from "./Progress.tsx";
import * as Transcript from "./transcript.ts";

/**
 * The notebook as a conversation with a coding agent.
 *
 * Each turn is a dialog cell inline with the work, followed by the cells the
 * agent made for it. A bar at the bottom appends the next prompt or cell, and
 * cells can be reordered afterwards from their margins.
 */
export function Dialog({ notebook }: ViewProps) {
  const path = useAtomValue(
    notebook.state,
    (result) => AsyncResult.getOrElse(result, () => undefined)?.notebook?.path ?? null,
  );
  const extensions: Extensions = {
    afterCell: ({ cell, model }) => (
      <AfterCell notebook={notebook} model={model} cellId={cell.id} />
    ),
    footer: ({ model }) => <Footer notebook={notebook} model={model} />,
    bottom: ({ model }) => (
      <BottomBar
        conversation={Conversation.forNotebook(notebook, model.document)}
        model={model}
        path={path}
      />
    ),
    insertBetween: false,
    cellKind: (cell) => (Transcript.isDialog(cell.code) ? "dialog" : undefined),
    preview: (cell) =>
      Option.match(Transcript.parse(cell.code), {
        onNone: () => undefined,
        onSome: (turn) => <TurnPreview turn={turn} />,
      }),
  };
  return (
    <div className="moku-dialog">
      <NotebookEditor notebook={notebook} extensions={extensions} />
    </div>
  );
}

/**
 * A turn as plain text, shown until marimo renders the dialog cell.
 *
 * The reply's Markdown appears unformatted here and is formatted once the cell runs.
 */
function TurnPreview({ turn }: { readonly turn: Transcript.Turn }) {
  return (
    <div className="dialog-turn-preview">
      <p className="dialog-turn-prompt">{turn.prompt}</p>
      <p className="dialog-turn-reply">{turn.reply || "Waiting for the agent…"}</p>
    </div>
  );
}

interface Props extends Pick<ViewProps, "notebook"> {
  readonly model: Model.Interface;
}

/** The agent's live reply, shown below the turn it answers. */
function AfterCell({ notebook, model, cellId }: Props & { readonly cellId: string }) {
  const conversation = Conversation.forNotebook(notebook, model.document);
  const turn = useAtomValue(conversation.live, (live) => live.turn);
  return turn === cellId ? <Progress conversation={conversation} /> : null;
}

/** Errors that happened before a turn had a cell to show them under. */
function Footer({ notebook, model }: Props) {
  const conversation = Conversation.forNotebook(notebook, model.document);
  const orphaned = useAtomValue(conversation.live, (live) => live.turn === null);
  return orphaned ? <Progress conversation={conversation} /> : null;
}
