import { useAtomValue } from "@effect/atom-react";
import type { Plugin } from "@moku/plugin";
import { AsyncResult, type Atom } from "effect/reactivity";
import * as ReactRouter from "react-router";

import type * as Application from "./Application.ts";
import { Launcher } from "./Launcher.tsx";
import { LauncherBar } from "./LauncherBar.tsx";
import { parseRoute, type Route } from "./routes.ts";
import { ViewHeader } from "./ViewHeader.tsx";
import { ViewInstance, ViewErrorBoundary } from "./ViewInstance.tsx";
import type * as Workspace from "./Workspace.ts";

export function App({ application }: { application: Application.Interface }) {
  const location = ReactRouter.useLocation();
  const route = parseRoute(
    new URL(location.pathname + location.search, window.location.origin),
  );
  const workspace = useAtomValue(application.workspace);
  if (!AsyncResult.isSuccess(workspace)) {
    const failed = AsyncResult.isFailure(workspace);
    return (
      <main className="auth-screen">
        <h1>moku</h1>
        <p>
          {failed
            ? "Open the authenticated launch link printed in your terminal."
            : "Connecting…"}
        </p>
        {failed && <code>bun dev</code>}
      </main>
    );
  }
  return (
    <WorkspaceApp application={application} workspace={workspace.value} route={route} />
  );
}

function WorkspaceApp({
  application,
  workspace,
  route,
}: {
  application: Application.Interface;
  workspace: Workspace.Interface;
  route: Route;
}) {
  const plugins = useAtomValue(application.plugins);
  if (!AsyncResult.isSuccess(plugins))
    return (
      <main className="empty-state">
        {AsyncResult.isFailure(plugins) ? "Could not load views." : "Loading views…"}
      </main>
    );
  return route.kind === "catalog" ? (
    <Launcher workspace={workspace} plugins={plugins.value} />
  ) : (
    <ViewPage
      application={application}
      workspace={workspace}
      state={plugins.value.state}
      route={route}
    />
  );
}

function ViewPage({
  application,
  workspace,
  state,
  route,
}: {
  application: Application.Interface;
  workspace: Workspace.Interface;
  state: Atom.Atom<Plugin.State>;
  route: Exclude<Route, { kind: "catalog" }>;
}) {
  const { views, failures } = useAtomValue(state);
  const view =
    route.kind === "view"
      ? views.find((view) => view.key === route.viewKey)
      : undefined;
  return (
    <div className="view-page">
      {route.kind === "view" ? (
        <ViewHeader
          target={route.target}
          viewKey={route.viewKey}
          views={views}
          application={application}
          workspace={workspace}
        />
      ) : (
        <LauncherBar />
      )}
      <main className="view-content">
        {route.kind === "view" && view ? (
          <ViewErrorBoundary
            key={`${route.target.connectionId}:${route.target.notebookId}`}
          >
            <ViewInstance target={route.target} view={view} application={application} />
          </ViewErrorBoundary>
        ) : (
          <div className="empty-state">
            <h1>
              {route.kind === "missing"
                ? "Page not found."
                : "This view is unavailable."}
            </h1>
            {failures.map((failure, index) => (
              <p key={`${failure.pluginId}:${index}`} role="alert">
                {failure.message}
              </p>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
