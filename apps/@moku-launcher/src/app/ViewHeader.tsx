import * as ReactRouter from "react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type * as Notebook from "./Notebook.ts";
import type * as Workspace from "./Workspace.ts";
import type { Plugin } from "@moku/plugin";
import type * as Application from "./Application.ts";
import { viewHref } from "./routes.ts";
import { LauncherBar } from "./LauncherBar.tsx";

export function ViewHeader({
  target,
  viewKey,
  views,
  application,
  workspace,
}: {
  target: Notebook.Target;
  viewKey: string;
  views: readonly Plugin.RegisteredView[];
  application: Application.Interface;
  workspace: Workspace.Interface;
}) {
  const navigate = ReactRouter.useNavigate();
  const { connections } = useAtomValue(workspace.state);
  const connection = connections.find((item) => item.id === target.connectionId);
  const attachment = useAtomValue(application.notebook(target));

  return (
    <LauncherBar
      actions={
        <select
          className="view-picker"
          aria-label="Switch view"
          value={viewKey}
          onChange={(event) =>
            void navigate(viewHref(target, event.currentTarget.value))
          }
        >
          {!views.some((view) => view.key === viewKey) && (
            <option value={viewKey} disabled>
              Unavailable view
            </option>
          )}
          {views.map((view) => (
            <option key={view.key} value={view.key}>
              {view.title}
            </option>
          ))}
        </select>
      }
    >
      <span aria-hidden="true">/</span>
      <span className="view-host" title={connection?.url ?? target.connectionId}>
        {connection?.name ?? target.connectionId}
      </span>
      <span aria-hidden="true">/</span>
      {AsyncResult.isSuccess(attachment) ? (
        <NotebookName notebook={attachment.value} />
      ) : (
        <span className="view-notebook" aria-current="page">
          {target.notebookId}
        </span>
      )}
    </LauncherBar>
  );
}

function NotebookName({ notebook }: { notebook: Notebook.Interface }) {
  const value = AsyncResult.getOrElse(useAtomValue(notebook.state), () => undefined);
  return (
    <span
      className="view-notebook"
      aria-current="page"
      title={value?.notebook?.path ?? notebook.target.notebookId}
    >
      {value?.notebook?.name ?? notebook.target.notebookId}
    </span>
  );
}
