import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, type Atom } from "effect/reactivity";
import * as ReactRouter from "react-router";
import type * as Workspace from "./Workspace.ts";
import { Launcher } from "./Launcher.tsx";
import { ViewInstance, ViewErrorBoundary } from "./ViewInstance.tsx";
import type { Runtime } from "./runtime.ts";
import { parseRoute, type Route } from "./routes.ts";
import type * as Host from "./views.ts";
import { ViewHeader } from "./ViewHeader.tsx";
import { LauncherBar } from "./LauncherBar.tsx";

export function App({ runtime }: { runtime: Runtime }) {
  const location = ReactRouter.useLocation();
  const route = parseRoute(
    new URL(location.pathname + location.search, window.location.origin),
  );
  const workspace = useAtomValue(runtime.workspace);
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
  return <WorkspaceApp runtime={runtime} workspace={workspace.value} route={route} />;
}

function WorkspaceApp({
  runtime,
  workspace,
  route,
}: {
  runtime: Runtime;
  workspace: Workspace.Workspace;
  route: Route;
}) {
  const host = useAtomValue(runtime.host);
  if (!AsyncResult.isSuccess(host))
    return (
      <main className="empty-state">
        {AsyncResult.isFailure(host) ? "Could not load views." : "Loading views…"}
      </main>
    );
  return route.kind === "catalog" ? (
    <Launcher workspace={workspace} host={host.value} />
  ) : (
    <ViewPage
      runtime={runtime}
      workspace={workspace}
      state={host.value.state}
      route={route}
    />
  );
}

function ViewPage({
  runtime,
  workspace,
  state,
  route,
}: {
  runtime: Runtime;
  workspace: Workspace.Workspace;
  state: Atom.Atom<Host.State>;
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
          runtime={runtime}
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
            <ViewInstance target={route.target} view={view} runtime={runtime} />
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
