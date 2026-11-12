import type * as Workspace from "@moku/core/Workspace";
import type * as Protocol from "@moku/core/Protocol";
import { viewHref } from "./routes.ts";
import { HOST_VIEW } from "./LauncherBar.tsx";
import { useOpenHost } from "./useOpenHost.ts";

export function NotebookRow({
  notebook,
  connectionId,
  selectedView,
  workspace,
}: {
  notebook: Protocol.NotebookOutput;
  connectionId: string;
  selectedView: string;
  workspace: Workspace.Workspace;
}) {
  const target = { connectionId, notebookId: notebook.id };
  const host = useOpenHost(workspace, target);
  const canOpen = notebook.operations.includes("notebook.open");
  const label = `Open ${notebook.name}`;
  return (
    <li>
      <div className="notebook-row" title={notebook.path ?? notebook.name}>
        <span className="notebook-label">
          <span className="notebook-name">{notebook.name}</span>
          <span className="notebook-metadata">
            <span className="notebook-path" title={notebook.path ?? notebook.id}>
              {notebook.path ?? `Notebook ID: ${notebook.id}`}
            </span>
            {notebook.updated_at && (
              <time
                dateTime={notebook.updated_at}
                title={new Date(notebook.updated_at).toLocaleString()}
              >
                Updated{" "}
                {new Date(notebook.updated_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </time>
            )}
          </span>
        </span>
        {selectedView === HOST_VIEW ? (
          <button
            type="button"
            className="notebook-open"
            aria-label={label}
            title={
              !canOpen
                ? "This host cannot open this notebook"
                : host.pending
                  ? "Opening…"
                  : "Open in Host"
            }
            disabled={!canOpen || host.pending}
            onClick={() => host.open()}
          >
            <span aria-hidden="true">{host.pending ? "…" : "↗"}</span>
          </button>
        ) : (
          <a
            className="notebook-open"
            href={viewHref(target, selectedView)}
            aria-label={label}
          >
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      {selectedView === HOST_VIEW && host.error && (
        <p className="error-banner" role="alert">
          {host.error}
        </p>
      )}
    </li>
  );
}
