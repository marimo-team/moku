import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import * as React from "react";
import type * as Workspace from "./Workspace.ts";
import type { Plugin } from "@moku/plugin";
import { HostNotebooks } from "./HostNotebooks.tsx";
import { AddHost } from "./AddHost.tsx";
import { LauncherBar } from "./LauncherBar.tsx";

export function Launcher({
  workspace,
  plugins,
}: {
  workspace: Workspace.Interface;
  plugins: Plugin.Loaded;
}) {
  const connections = useAtomValue(workspace.state, (state) => state.connections);
  const discovery = useAtomValue(workspace.state, (state) => state.status);
  const pending = discovery._tag === "Pending";
  const { views, failures } = useAtomValue(plugins.state);
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
            <AddHost workspace={workspace} />
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
              views={views}
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
