import { useId, useMemo, useRef } from "react";
import { useAtom } from "@effect/atom-react";
import { Cause, Effect } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import type * as Workspace from "@moku/core/Workspace";
import type * as Protocol from "@moku/core/Protocol";
import type { RegisteredView } from "./Host.ts";
import { viewHref } from "./routes.ts";

export function NotebookRow({
  notebook,
  connectionId,
  views,
  workspace,
}: {
  notebook: Protocol.NotebookOutput;
  connectionId: string;
  views: readonly RegisteredView[];
  workspace: Workspace.Workspace;
}) {
  const id = useId();
  const open = useMemo(
    () =>
      Atom.fn(() =>
        workspace
          .open({
            connectionId,
            notebookId: notebook.id,
            requestId: crypto.randomUUID(),
          })
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => document.getElementById(id)?.hidePopover()),
            ),
          ),
      ).pipe(Atom.setIdleTTL(0)),
    [workspace, connectionId, notebook.id, id],
  );
  const [opening, openHost] = useAtom(open);
  const pending = opening.waiting;
  const error =
    !pending && AsyncResult.isFailure(opening) ? Cause.squash(opening.cause) : null;
  const canOpen = notebook.operations.includes("notebook.open");
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <li>
      <button
        ref={trigger}
        type="button"
        className="notebook-row"
        popoverTarget={id}
        aria-haspopup="dialog"
        aria-label={`Open ${notebook.name} with…`}
        title={notebook.path ?? notebook.name}
      >
        <svg
          className="file-icon"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 1.75h5L12.5 5v9.25H4Z" />
          <path d="M9 1.75V5h3.5M2 5h3M2 8h3M2 11h3" />
        </svg>
        <span className="notebook-label">
          <span className="notebook-name">{notebook.name}</span>
          {notebook.path &&
            notebook.path !== notebook.name &&
            notebook.path !== `${notebook.name}.py` && (
              <span className="notebook-path">{notebook.path}</span>
            )}
        </span>
      </button>
      <div
        id={id}
        popover="auto"
        className="open-with"
        role="dialog"
        aria-labelledby={`${id}-heading`}
        onToggle={(event) => {
          if (event.newState !== "open" || !trigger.current) return;
          const panel = event.currentTarget;
          const row = trigger.current.getBoundingClientRect();
          const bounds = panel.getBoundingClientRect();
          panel.style.left = `${Math.max(8, Math.min(row.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
          panel.style.top = `${Math.max(8, Math.min(row.bottom + 4, window.innerHeight - bounds.height - 8))}px`;
          panel.querySelector<HTMLElement>("button, a")?.focus();
        }}
      >
        <h3 id={`${id}-heading`}>Open with</h3>
        {canOpen && (
          <>
            <button type="button" disabled={pending} onClick={() => openHost()}>
              {pending ? "Opening…" : "Host"}
            </button>
            {views.length > 0 && <hr />}
          </>
        )}
        {!!error && (
          <p role="alert">
            {error instanceof Error ? error.message : "Could not open the notebook."}
          </p>
        )}
        {views.length
          ? views.map((view) => (
              <a
                key={view.key}
                href={viewHref({ connectionId, notebookId: notebook.id }, view.key)}
              >
                {view.title} <span className="open-with-detail">(plugin)</span>
              </a>
            ))
          : !canOpen && <p>No views available.</p>}
      </div>
    </li>
  );
}
