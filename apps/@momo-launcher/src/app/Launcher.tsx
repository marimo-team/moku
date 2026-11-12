import { useAtomValue } from "@effect/atom-react";
import { Effect } from "effect";
import type * as Workspace from "@momo/model/Workspace";
import type * as Host from "./Host.ts";
import { HostNotebooks } from "./HostNotebooks.tsx";

export function Launcher({
  workspace,
  host,
}: {
  workspace: Workspace.Workspace;
  host: Effect.Success<ReturnType<typeof Host.make>>;
}) {
  const connections = useAtomValue(workspace.state, (state) => state.connections);
  const discovery = useAtomValue(workspace.state, (state) => state.status);
  const { views, failures } = useAtomValue(host.state);
  const preferred = import.meta.env.VITE_MOMO_VIEW;
  const orderedViews = views.toSorted(
    (a, b) => Number(b.key === preferred) - Number(a.key === preferred),
  );
  const refresh = () =>
    Effect.runPromise(workspace.refresh.pipe(Effect.catch(() => Effect.void)));
  return (
    <main className="catalog-page">
      <header className="catalog-heading">
        <h1>Notebooks</h1>
        <button
          type="button"
          className="refresh-hosts"
          aria-label="Refresh hosts"
          title="Refresh hosts"
          disabled={discovery.pending}
          onClick={() => void refresh()}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13 6a5 5 0 1 0 0 4M13 2v4H9" />
          </svg>
        </button>
      </header>
      <div className="catalog-content">
        {discovery.error && (
          <p className="error-banner" role="alert">
            {discovery.error.message}
          </p>
        )}
        {failures.map((failure, index) => (
          <p key={`${failure.pluginId}:${index}`} className="error-banner" role="alert">
            Could not load {failure.pluginId}: {failure.message}
          </p>
        ))}
        {connections.length ? (
          connections.map((connection) => (
            <HostNotebooks
              key={connection.id}
              connection={connection}
              workspace={workspace}
              views={orderedViews}
            />
          ))
        ) : (
          <div className="catalog-empty">
            <p>
              {discovery.pending
                ? "Discovering local hosts…"
                : "No notebooks connected."}
            </p>
            {!discovery.pending && <code>marimo edit your_notebook.py</code>}
          </div>
        )}
      </div>
    </main>
  );
}
