import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import * as React from "react";
import * as ReactDOM from "react-dom";
import * as Outputs from "@moku/outputs";
import type { ViewProps } from "@moku/plugin";
import { empty } from "../empty.ts";
import * as Model from "../notebook/model.ts";
import * as Theme from "../notebook/appearance/theme.ts";
import * as CellOutputs from "../notebook/outputs.ts";
import { useDraftNavigationGuard } from "../notebook/useDraftNavigationGuard.ts";
import { CELL_NAME as BOARD_CELL } from "./board.ts";
import type { DebugRun, DebugState } from "./debug.ts";
import { EmbedCard } from "./EmbedCard.tsx";
import { type Card, Controller, type SaveState } from "./controller.ts";
import { helpersOf } from "./reconcile.ts";
import type { LinkItem } from "sketcher";

/** The Drawing view: one board per notebook, stored in the notebook itself. */
export function DrawingView({ notebook }: ViewProps) {
  const model = useAtomValue(Model.forNotebook(notebook));
  const appearance = useAtomValue(Theme.appearance);
  React.useEffect(() => {
    Outputs.setTheme(appearance);
  }, [appearance]);
  return (
    <div className="sketcher-view" data-theme={appearance}>
      {AsyncResult.isSuccess(model) ? (
        <Board notebook={notebook} model={model.value} appearance={appearance} />
      ) : (
        <p className="sketcher-message" role="status">
          {AsyncResult.isFailure(model)
            ? "Could not open notebook."
            : "Opening notebook…"}
        </p>
      )}
    </div>
  );
}

function Board({
  notebook,
  model,
  appearance,
}: Pick<ViewProps, "notebook"> & {
  model: Model.Interface;
  appearance: "light" | "dark";
}) {
  const draft = useAtomValue(model.document.state);
  const connection = useAtomValue(notebook.state);
  const state = AsyncResult.getOrElse(connection, () => empty);
  const selection = useAtomValue(model.outputs);
  const setPreference = useAtomSet(Theme.preference);

  const host = React.useRef<HTMLDivElement>(null);
  const [controller, setController] = React.useState<Controller | null>(null);
  const [cards, setCards] = React.useState<ReadonlyMap<string, Card>>(new Map());
  const [codeShown, setCodeShown] = React.useState<ReadonlySet<string>>(new Set());
  const [save, setSave] = React.useState<SaveState>({ kind: "saved" });
  const [problem, setProblem] = React.useState<string | null>(null);
  const [shownLink, setShownLink] = React.useState<LinkItem | null>(null);
  const [debug, setDebug] = React.useState<DebugState>({ kind: "idle" });
  const [debugAsking, setDebugAsking] = React.useState(false);
  const [autoDebug, setAutoDebug] = React.useState(true);

  // The board opens once the document's source has arrived, and lives as long as the view.
  const ready = draft.document !== null;
  const initialAppearance = React.useRef(appearance);
  React.useEffect(() => {
    const el = host.current;
    if (!ready || !el) return;
    let active = true;
    let opened: Controller | null = null;
    void Controller.open({
      host: el,
      notebook,
      document: model.document,
      appearance: initialAppearance.current,
      callbacks: {
        cards: setCards,
        save: setSave,
        problem: setProblem,
        appearance: (a) => setPreference(a),
        open: (item) =>
          setCodeShown((shown) => {
            const next = new Set(shown);
            if (!next.delete(item.id)) next.add(item.id);
            return next;
          }),
        openLink: setShownLink,
        debug: setDebug,
      },
    }).then((c) => {
      if (!active) return c.destroy();
      opened = c;
      setController(c);
    });
    return () => {
      active = false;
      opened?.destroy();
      setController(null);
      setCards(new Map());
    };
  }, [ready, notebook, model.document, setPreference]);

  React.useEffect(() => {
    controller?.sketcher.setAppearance(appearance);
  }, [controller, appearance]);

  const unsaved =
    save.kind !== "saved" ||
    (!!state.document && state.document.etag !== state.document.saved_etag);
  useDraftNavigationGuard(model.document, unsaved);

  const cellsByName = new Map(
    [...(draft.document?.cells.values() ?? [])].map((c) => [c.name, c]),
  );
  const runtimeState = state.runtime?.state;
  const runtime = !runtimeState
    ? "stopped"
    : runtimeState.status === "ended"
      ? runtimeState.outcome.kind
      : runtimeState.status;
  const error = save.kind === "error" ? save.message : problem;

  // Cells failing now (cards' and helpers' alike), for the Debug agent.
  const failing = [...(draft.document?.cells.values() ?? [])].flatMap((cell) => {
    if (cell.name === BOARD_CELL || cell.code === null) return [];
    const outputs = CellOutputs.forCell(state, selection, cell.id);
    const current = selection.current.get(cell.id);
    const busy = current !== undefined && current.state.status !== "completed";
    if (busy || outputs.outcome?.kind !== "failed") return [];
    const e = outputs.outcome.error;
    return [
      {
        cell: cell.name,
        code: cell.code,
        error: [e.name, e.kind, e.message].filter(Boolean).join(": "),
      },
    ];
  });
  const failingKey = JSON.stringify(failing);
  React.useEffect(() => {
    controller?.reportErrors(JSON.parse(failingKey));
  }, [controller, failingKey]);
  React.useEffect(() => {
    if (controller) controller.autoDebug = autoDebug;
  }, [controller, autoDebug]);

  return (
    <>
      <div ref={host} className="sketcher-board" />
      {!controller && (
        <p className="sketcher-message" role="status">
          {ready ? "Opening the board…" : "Loading the notebook…"}
        </p>
      )}
      <div className="sketcher-status" role="status">
        <span
          className="sketcher-dot"
          data-state={runtime}
          title={`Runtime ${runtime}`}
        />
        <span>{runtime === "ready" ? "Kernel ready" : `Kernel ${runtime}`}</span>
        <span className="sketcher-sep" />
        <span>
          {save.kind === "saving"
            ? "Saving…"
            : save.kind === "unsaved"
              ? "Unsaved changes"
              : save.kind === "saved"
                ? "Saved"
                : "Not saved"}
        </span>
        {controller && (
          <>
            <span className="sketcher-sep" />
            <button type="button" onClick={() => controller.runAll()}>
              Run all
            </button>
            <button
              type="button"
              className="sketcher-debug-button"
              data-busy={debug.kind === "running" || undefined}
              title="Have Claude look at the running notebook and fix what's wrong"
              onClick={() => setDebugAsking((open) => !open)}
            >
              {debug.kind === "running" ? "Debugging…" : "Debug"}
            </button>
            <label
              className="sketcher-auto"
              title="Have Claude fix failing cells on its own"
            >
              <input
                type="checkbox"
                checked={autoDebug}
                onChange={(e) => setAutoDebug(e.currentTarget.checked)}
              />
              Auto-fix
            </label>
          </>
        )}
        <span className="sketcher-hint">
          Lasso (S) some drawing, then Ask (⌘K) · Connect (C): drag from card to card
        </span>
      </div>
      {error && (
        <p className="sketcher-problem" role="alert">
          {error}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() =>
              save.kind === "error" ? setSave({ kind: "unsaved" }) : setProblem(null)
            }
          >
            ×
          </button>
        </p>
      )}
      {controller && debugAsking && (
        <DebugPrompt
          failing={failing.map((f) => f.cell)}
          onSend={(note) => {
            setDebugAsking(false);
            controller.debug(note);
          }}
          onCancel={() => setDebugAsking(false)}
        />
      )}
      {controller && debug.kind !== "idle" && !debugAsking && (
        <DebugPanel
          state={debug}
          onStop={() => controller.stopDebug()}
          onClose={() => controller.dismissDebug()}
        />
      )}
      {shownLink && (
        <LinkPanel
          link={shownLink}
          names={(id) => {
            const e = controller?.sketcher.getEmbeds().find((x) => x.id === id);
            return e ? e.title || e.ref : "?";
          }}
          onClose={() => setShownLink(null)}
        />
      )}
      {controller &&
        [...cards.values()].map((card) => {
          const cell = cellsByName.get(card.ref);
          return ReactDOM.createPortal(
            <EmbedCard
              cellId={cell?.id ?? null}
              name={card.ref}
              code={cell?.code ?? null}
              showCode={codeShown.has(card.id)}
              state={state}
              selection={selection}
              onFix={(message) => controller.fix(card.id, message)}
              onRecreate={() => controller.recreate(card.id)}
              onRemove={() => controller.remove(card.id)}
            />,
            card.el,
            card.id,
          );
        })}
    </>
  );
}

/** What a connection did: what it asked, what flows along it, and the helper cells it brought. */
function LinkPanel({
  link,
  names,
  onClose,
}: {
  link: LinkItem;
  names: (id: string) => string;
  onClose: () => void;
}) {
  const helpers = helpersOf(link);
  const prompt = typeof link.data?.prompt === "string" ? link.data.prompt : "";
  return (
    <div className="sketcher-link-panel" role="dialog" aria-label="Connection">
      <header>
        <strong>
          {names(link.from)} → {names(link.to)}
        </strong>
        {link.label && <code>{link.label}</code>}
        <button type="button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {prompt && <p>“{prompt}”</p>}
      {helpers.length === 0 ? (
        <p className="sketcher-link-note">
          No helper cells: the cards read each other directly.
        </p>
      ) : (
        helpers.map((h) => (
          <section key={h.name}>
            <h4>
              Helper cell <code>{h.name}</code>
            </h4>
            <pre>{h.code}</pre>
          </section>
        ))
      )}
    </div>
  );
}

/** What the person tells the Debug agent. */
function DebugPrompt({
  failing,
  onSend,
  onCancel,
}: {
  failing: readonly string[];
  onSend: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = React.useState("");
  return (
    <div
      className="sketcher-debug-prompt"
      role="dialog"
      aria-label="Debug"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") onCancel();
        else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onSend(note);
        }
      }}
    >
      <strong>What's wrong?</strong>
      <textarea
        autoFocus
        rows={3}
        value={note}
        placeholder="e.g. the histogram doesn't show, I asked for matplotlib. Or press ↩ and Claude looks around."
        onChange={(e) => setNote(e.currentTarget.value)}
      />
      {failing.length > 0 && (
        <p className="sketcher-link-note">
          Failing now, sent along: {failing.map((c) => c).join(", ")}
        </p>
      )}
      <div className="sketcher-debug-actions">
        <span>Claude works in the running notebook with marimo-pair.</span>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="sketcher-primary" onClick={() => onSend(note)}>
          Debug
        </button>
      </div>
    </div>
  );
}

/** What the Debug agent is doing, and what it found. */
function DebugPanel({
  state,
  onStop,
  onClose,
}: {
  state: DebugRun;
  onStop: () => void;
  onClose: () => void;
}) {
  const running = state.kind === "running";
  return (
    <div
      className="sketcher-link-panel sketcher-debug-panel"
      role="status"
      data-kind={state.kind}
    >
      <header>
        <strong>
          {running
            ? "✦ Debugging"
            : state.kind === "done"
              ? "✦ Debugged"
              : "✦ Debug stopped"}
          {state.auto ? " (automatic)" : ""}
        </strong>
        {running ? (
          <button type="button" className="sketcher-text-button" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        )}
      </header>
      <p>{state.about}</p>
      {state.steps.length > 0 && (
        <ol>
          {state.steps.slice(running ? -6 : -12).map((step, i) => (
            <li key={`${i}-${step}`}>
              {step.length > 160 ? `${step.slice(0, 159)}…` : step}
            </li>
          ))}
        </ol>
      )}
      {state.summary && <p className="sketcher-debug-summary">{state.summary}</p>}
    </div>
  );
}
