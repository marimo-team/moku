import { useEffect, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import type * as Workspace from "@momo/model/Workspace";
import type * as Host from "./Host.ts";
import { useCatalog } from "./catalog.ts";
import type { Runtime } from "./runtime.ts";
import { ViewInstance, ViewErrorBoundary, type OpenView } from "./ViewInstance.tsx";

export function Launcher({
  workspace,
  host,
  runtime,
}: {
  workspace: Workspace.Workspace;
  host: Effect.Success<ReturnType<typeof Host.make>>;
  runtime: Runtime;
}) {
  const connections = useAtomValue(workspace.connections);
  const discovery = useAtomValue(workspace.status);
  const { views, failures } = useAtomValue(host.state);
  const [selectedHost, selectHost] = useState("");
  const connectionId =
    connections.find((host) => host.id === selectedHost)?.id ??
    connections[0]?.id ??
    "";
  const catalog = useCatalog(workspace, connectionId);
  const [selectedNotebook, selectNotebook] = useState("");
  const notebook =
    catalog.notebooks.find((item) => item.id === selectedNotebook) ??
    catalog.notebooks[0];
  const [selectedView, selectView] = useState<string>(
    import.meta.env.VITE_MOMO_VIEW ?? "",
  );
  const view = views.find((item) => item.key === selectedView) ?? views[0];
  const [instances, setInstances] = useState<OpenView[]>([]);
  const [selectedInstance, selectInstance] = useState("");
  const active =
    instances.find((item) => item.id === selectedInstance)?.id ?? instances.at(-1)?.id;
  useEffect(() => {
    setInstances((current) =>
      current.filter((instance) => views.some((view) => view.key === instance.viewKey)),
    );
  }, [views]);
  const refresh = () =>
    Effect.runPromise(workspace.refresh.pipe(Effect.catch(() => Effect.void)));
  function open() {
    if (!notebook || !view || !connectionId) return;
    const instance: OpenView = {
      id: crypto.randomUUID(),
      viewKey: view.key,
      target: { connectionId, notebookId: notebook.id },
      notebookName: notebook.name,
    };
    setInstances((current) => [...current, instance]);
    selectInstance(instance.id);
  }
  return (
    <main className="launcher">
      <header className="launcher-toolbar">
        <span className="app-name">momo</span>
        <select
          aria-label="Marimo host"
          value={connectionId}
          onChange={(event) => {
            selectHost(event.target.value);
            selectNotebook("");
          }}
          disabled={!connections.length}
        >
          {!connections.length && (
            <option value="">
              {discovery.pending ? "Discovering hosts…" : "No running hosts"}
            </option>
          )}
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name} · {new URL(connection.url).host}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          aria-label="Refresh hosts"
          title="Refresh hosts"
          disabled={discovery.pending}
          onClick={() => void refresh()}
        >
          ↻
        </button>
        <select
          aria-label="Notebook"
          value={notebook?.id ?? ""}
          onChange={(event) => selectNotebook(event.target.value)}
          disabled={!catalog.notebooks.length}
        >
          {!catalog.notebooks.length && (
            <option value="">
              {catalog.ready ? "No notebooks" : "Select a notebook"}
            </option>
          )}
          {catalog.notebooks.map((notebook) => (
            <option key={notebook.id} value={notebook.id}>
              {notebook.path ?? notebook.name}
            </option>
          ))}
        </select>
        <select
          aria-label="View"
          value={view?.key ?? ""}
          onChange={(event) => selectView(event.target.value)}
          disabled={!views.length}
        >
          {!views.length && <option value="">No views available</option>}
          {views.map((view) => (
            <option key={view.key} value={view.key}>
              {view.title}
            </option>
          ))}
        </select>
        <button
          className="open-view-button"
          disabled={!notebook || !view || !catalog.ready}
          onClick={open}
        >
          Open view
        </button>
      </header>
      {(discovery.error || catalog.error) && (
        <div className="error-banner" role="alert">
          {discovery.error?.message || catalog.error}
        </div>
      )}
      {failures.map((failure, index) => (
        <div key={`${failure.pluginId}:${index}`} className="error-banner" role="alert">
          Could not load {failure.pluginId}: {failure.message}
        </div>
      ))}
      {instances.length ? (
        <>
          <nav className="view-tabs" aria-label="Open views">
            {instances.map((instance) => (
              <div
                className="view-tab"
                key={instance.id}
                data-active={instance.id === active}
              >
                <button
                  type="button"
                  aria-pressed={instance.id === active}
                  aria-controls={`view-${instance.id}`}
                  onClick={() => selectInstance(instance.id)}
                >
                  {instance.notebookName} ·{" "}
                  {views.find((view) => view.key === instance.viewKey)?.title}
                </button>
                <button
                  type="button"
                  className="close-view"
                  aria-label={`Close ${instance.notebookName} ${views.find((view) => view.key === instance.viewKey)?.title ?? "view"}`}
                  onClick={() =>
                    setInstances((current) =>
                      current.filter((item) => item.id !== instance.id),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </nav>
          {instances.map((instance) => {
            const view = views.find((view) => view.key === instance.viewKey);
            return (
              view && (
                <section
                  id={`view-${instance.id}`}
                  className="view-instance"
                  key={instance.id}
                  hidden={instance.id !== active}
                  aria-label={`${instance.notebookName} ${view.title}`}
                >
                  <ViewErrorBoundary>
                    <ViewInstance instance={instance} view={view} runtime={runtime} />
                  </ViewErrorBoundary>
                </section>
              )
            );
          })}
        </>
      ) : (
        <div className="empty-state">
          <h1>Open a notebook view.</h1>
          <p>Choose a notebook and a view above. Open more views to compare them.</p>
          {!connections.length && <code>marimo edit your_notebook.py</code>}
        </div>
      )}
    </main>
  );
}
