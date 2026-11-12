import { useId, useRef } from "react";
import type * as Protocol from "@momo/model/Protocol";
import type { RegisteredView } from "./Host.ts";
import { viewHref } from "./routes.ts";

export function NotebookRow({
  notebook,
  connectionId,
  views,
}: {
  notebook: Protocol.NotebookOutput;
  connectionId: string;
  views: readonly RegisteredView[];
}) {
  const id = useId();
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
          panel.querySelector<HTMLAnchorElement>("a")?.focus();
        }}
      >
        <h3 id={`${id}-heading`}>Open with</h3>
        {views.length ? (
          views.map((view) => (
            <a
              key={view.key}
              href={viewHref({ connectionId, notebookId: notebook.id }, view.key)}
            >
              {view.title}
            </a>
          ))
        ) : (
          <p>No views available.</p>
        )}
      </div>
    </li>
  );
}
