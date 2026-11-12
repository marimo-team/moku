import type * as Workspace from "@momo/model/Workspace";
import type { RegisteredView } from "./Host.ts";
import { useCatalog } from "./catalog.ts";
import { NotebookRow } from "./NotebookRow.tsx";

export function HostNotebooks({
  connection,
  workspace,
  views,
}: {
  connection: Workspace.Connection;
  workspace: Workspace.Workspace;
  views: readonly RegisteredView[];
}) {
  const catalog = useCatalog(workspace, connection.id);
  const notebooks = catalog.notebooks.toSorted((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="host-section" aria-label={connection.name}>
      <header className="host-heading">
        <h2 title={connection.url}>{connection.name}</h2>
        {connection.name !== new URL(connection.url).host && (
          <span className="host-address">{new URL(connection.url).host}</span>
        )}
        <span className="host-count">
          {catalog.ready
            ? `${notebooks.length} ${notebooks.length === 1 ? "notebook" : "notebooks"}`
            : "Connecting…"}
        </span>
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
              views={views}
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
