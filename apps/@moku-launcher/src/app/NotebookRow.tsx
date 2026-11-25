import * as Menu from "@radix-ui/react-dropdown-menu";
import * as ReactRouter from "react-router";
import type * as Workspace from "./Workspace.ts";
import type * as Protocol from "@moku/core/Protocol";
import type { Plugin } from "@moku/plugin";
import { viewHref } from "./routes.ts";
import { useOpenHost } from "./useOpenHost.ts";

export function NotebookRow({
  notebook,
  connectionId,
  views,
  workspace,
}: {
  notebook: typeof Protocol.Notebook.Type;
  connectionId: string;
  views: readonly Plugin.RegisteredView[];
  workspace: Workspace.Interface;
}) {
  const target = { connectionId, notebookId: notebook.id };
  const host = useOpenHost(workspace, target);
  const canOpen = notebook.operations.includes("notebook.open");
  return (
    <li>
      <div className="notebook-row" title={notebook.path ?? notebook.name}>
        <span className="notebook-label">
          <span className="notebook-name">{notebook.name}</span>
          <span className="notebook-metadata">
            <span className="notebook-path" title={notebook.path ?? notebook.id}>
              {notebook.path ?? `Notebook ID: ${notebook.id}`}
            </span>
            {notebook.modified_at && (
              <time
                dateTime={notebook.modified_at}
                title={new Date(notebook.modified_at).toLocaleString()}
              >
                Updated{" "}
                {new Date(notebook.modified_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </time>
            )}
          </span>
        </span>
        <Menu.Root modal={false}>
          <Menu.Trigger
            className="notebook-open"
            aria-label={`Open ${notebook.name}`}
            title="Open with…"
          >
            <span aria-hidden="true">↗</span>
          </Menu.Trigger>
          <Menu.Content
            className="open-menu"
            align="end"
            sideOffset={4}
            collisionPadding={8}
          >
            <Menu.Item disabled={!canOpen || host.pending} onSelect={() => host.open()}>
              {host.pending ? "Opening…" : "Host"} <span aria-hidden="true">↗</span>
            </Menu.Item>
            {views.length > 0 && <Menu.Separator />}
            {views.map((view) => (
              <Menu.Item key={view.key} asChild>
                <ReactRouter.Link to={viewHref(target, view.key)}>
                  {view.title}
                </ReactRouter.Link>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      </div>
      {host.error && (
        <p className="error-banner" role="alert">
          {host.error}
        </p>
      )}
    </li>
  );
}
