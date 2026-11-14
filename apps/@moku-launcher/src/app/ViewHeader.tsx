import * as Observation from "../plugins/observation.ts";
import * as React from "react";
import * as ReactRouter from "react-router";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import type * as Notebook from "./Notebook.ts";
import type * as Workspace from "./Workspace.ts";
import type { RegisteredView } from "./views.ts";
import type * as Runtime from "./runtime.ts";
import { viewHref } from "./routes.ts";
import { LauncherBar, ViewPicker, rememberView } from "./LauncherBar.tsx";

export function ViewHeader({
  target,
  viewKey,
  views,
  runtime,
  workspace,
}: {
  target: Notebook.Target;
  viewKey: string;
  views: readonly RegisteredView[];
  runtime: Runtime.Interface;
  workspace: Workspace.Interface;
}) {
  const navigate = ReactRouter.useNavigate();
  React.useEffect(() => rememberView(viewKey), [viewKey]);
  const { connections } = useAtomValue(workspace.state);
  const connection = connections.find((item) => item.id === target.connectionId);
  const attachment = useAtomValue(runtime.notebook(target));

  return (
    <LauncherBar
      actions={
        <ViewPicker
          value={viewKey}
          views={views}
          includeHost={false}
          onChange={(value) => {
            rememberView(value);
            void navigate(viewHref(target, value));
          }}
        />
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
  const { value } = Observation.read(useAtomValue(notebook.state));
  return (
    <span
      className="view-notebook"
      aria-current="page"
      title={value.notebook?.path ?? notebook.target.notebookId}
    >
      {value.notebook?.name ?? notebook.target.notebookId}
    </span>
  );
}
