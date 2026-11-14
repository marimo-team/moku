import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import * as React from "react";
import type * as Workspace from "./Workspace.ts";
import type * as Host from "./views.ts";
import { HostNotebooks } from "./HostNotebooks.tsx";
import {
  LauncherBar,
  ViewPicker,
  HOST_VIEW,
  preferredView,
  rememberView,
} from "./LauncherBar.tsx";

export function Launcher({
  workspace,
  host,
}: {
  workspace: Workspace.Interface;
  host: Host.Interface;
}) {
  const connections = useAtomValue(workspace.state, (state) => state.connections);
  const discovery = useAtomValue(workspace.state, (state) => state.status);
  const pending = discovery._tag === "Pending";
  const { views, failures } = useAtomValue(host.state);
  const [preference, setPreference] = React.useState(preferredView);
  const selectedView = views.some((view) => view.key === preference)
    ? preference
    : HOST_VIEW;
  const refresh = useAtomSet(
    React.useMemo(
      () => Atom.fn(() => workspace.refresh).pipe(Atom.setIdleTTL(0)),
      [workspace],
    ),
  );
  return (
    <main className="catalog-page">
      <LauncherBar
        actions={
          <>
            <ViewPicker
              value={selectedView}
              views={views}
              onChange={(value) => {
                rememberView(value);
                setPreference(value);
              }}
            />
            <button
              type="button"
              className="refresh-hosts"
              aria-label="Refresh hosts"
              title="Refresh hosts"
              disabled={pending}
              onClick={() => refresh()}
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
          </>
        }
      />
      <div className="catalog-content">
        {discovery._tag === "Failed" && (
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
              selectedView={selectedView}
            />
          ))
        ) : (
          <div className="catalog-empty">
            <p>{pending ? "Discovering local hosts…" : "No notebooks connected."}</p>
            {!pending && <code>marimo edit your_notebook.py</code>}
          </div>
        )}
      </div>
    </main>
  );
}
