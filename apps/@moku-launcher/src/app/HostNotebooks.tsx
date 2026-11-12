import type * as Workspace from "@moku/core/Workspace";
import { useCatalog } from "./catalog.ts";
import { NotebookRow } from "./NotebookRow.tsx";

export function HostNotebooks({
  connection,
  workspace,
  selectedView,
}: {
  connection: Workspace.Connection;
  workspace: Workspace.Workspace;
  selectedView: string;
}) {
  const catalog = useCatalog(workspace, connection.id);
  const notebooks = catalog.notebooks.toSorted((a, b) => a.name.localeCompare(b.name));
  const address = new URL(connection.url);
  return (
    <section className="host-section" aria-label={connection.name}>
      <header className="host-heading">
        <h2 title={`${connection.name} · ${connection.url}`}>
          {address.host}
          {address.pathname === "/" ? "" : address.pathname}
        </h2>
        <div className="host-facts">
          {connection.pid !== undefined && <span>PID {connection.pid}</span>}
          <span>
            {catalog.ready
              ? `${notebooks.length} ${notebooks.length === 1 ? "notebook" : "notebooks"}`
              : "Reading…"}
          </span>
        </div>
      </header>
      {catalog.error && (
        <p className="error-banner" role="alert">
          {catalog.error}
        </p>
      )}
      {notebooks.length ? (
        <ul className="notebook-list">
          {notebooks.map((notebook) => (
            <NotebookRow
              key={notebook.id}
              notebook={notebook}
              connectionId={connection.id}
              workspace={workspace}
              selectedView={selectedView}
            />
          ))}
        </ul>
      ) : (
        !catalog.error && (
          <p className="catalog-notice">
            {catalog.ready ? "This host has no notebooks yet." : "Reading notebooks…"}
          </p>
        )
      )}
    </section>
  );
}
