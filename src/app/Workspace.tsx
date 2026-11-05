import { useEffect, useState } from "react";
import type { HostSummary } from "../../server/api.ts";
import { useCatalog } from "../notebook/connection.ts";
import { NotebookView } from "../notebook/NotebookView.tsx";

export function Workspace() {
  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [hostId, setHostId] = useState("");
  const [notebookId, setNotebookId] = useState("");
  const [error, setError] = useState("");
  const [discovering, setDiscovering] = useState(true);
  async function refresh() {
    setDiscovering(true);
    setError("");
    try {
      const response = await fetch("/api/hosts");
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "Session expired. Reopen the launch link from your terminal."
            : "Could not discover local hosts.",
        );
      const found: HostSummary[] = await response.json();
      setHosts(found);
      setHostId((current) =>
        found.some((host) => host.id === current) ? current : (found[0]?.id ?? ""),
      );
    } catch (error) {
      setError(String(error));
    } finally {
      setDiscovering(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  const catalog = useCatalog(hostId);
  const chosen =
    catalog.notebooks.find((notebook) => notebook.id === notebookId) ?? catalog.notebooks[0];
  return (
    <main className="app">
      <div className="connection-toolbar">
        <span className="app-name">dag</span>
        <span className="toolbar-separator" />
        <select
          aria-label="Marimo host"
          value={hostId}
          onChange={(event) => {
            setHostId(event.target.value);
            setNotebookId("");
          }}
          disabled={!hosts.length}
        >
          {!hosts.length && (
            <option value="">{discovering ? "Discovering hosts…" : "No running hosts"}</option>
          )}
          {hosts.map((host) => (
            <option key={host.id} value={host.id}>
              {host.name} · localhost:{new URL(host.url).port}
            </option>
          ))}
        </select>
        <button
          className="icon-button"
          onClick={() => void refresh()}
          disabled={discovering}
          aria-label="Refresh hosts"
          title="Refresh hosts"
        >
          ↻
        </button>
        <select
          aria-label="Notebook"
          value={chosen?.id ?? ""}
          onChange={(event) => setNotebookId(event.target.value)}
          disabled={!catalog.notebooks.length}
        >
          {!catalog.notebooks.length && (
            <option value="">{catalog.ready ? "No notebooks" : "Select a notebook"}</option>
          )}
          {catalog.notebooks.map((notebook) => (
            <option key={notebook.id} value={notebook.id}>
              {notebook.path ?? notebook.name}
            </option>
          ))}
        </select>
        <span className="local-indicator">
          <i /> Local · authenticated
        </span>
      </div>
      {(error || catalog.error) && (
        <div className="error-banner" role="alert">
          {error || catalog.error}
        </div>
      )}
      {chosen ? (
        <NotebookView
          key={`${hostId}:${chosen.id}`}
          client={catalog.client}
          id={chosen.id}
          name={chosen.name}
        />
      ) : (
        <div className="empty-state">
          <h1>Watch a notebook run.</h1>
          <p>Start a marimo host, then select a notebook above.</p>
          <code>marimo edit your_notebook.py</code>
        </div>
      )}
    </main>
  );
}
