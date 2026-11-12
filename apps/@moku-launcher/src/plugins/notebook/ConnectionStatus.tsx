import type * as Notebook from "@moku/core/Notebook";
type Status = Notebook.State["status"];
import * as Problems from "./feedback/problems.ts";
import { useEffect, useRef } from "react";

export function ConnectionStatus({
  status,
  ready,
  compact = false,
  error,
  retry,
}: {
  status: Status;
  ready: boolean;
  compact?: boolean;
  error?: unknown;
  retry?: () => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (menu.current?.open && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const problem = error === undefined ? undefined : Problems.describe(error);
  const live = !problem && status === "connected" && ready;
  const label =
    problem?.title ??
    (live ? "Live" : status === "reconnecting" ? "Reconnecting…" : "Connecting…");
  const indicator = (
    <span
      className={`connection-status ${live ? "live" : ""}`}
      role="status"
      aria-label={label}
      title={label}
    >
      <span className="status-dot" />
      {(!compact || !live) && (
        <span className="connection-status-label">
          {compact && problem
            ? {
                authentication: "Needs token",
                unavailable: "Unavailable",
                disconnected: "Disconnected",
                error: "Connection issue",
              }[problem.category]
            : label}
        </span>
      )}
    </span>
  );
  if (!problem) return indicator;
  return (
    <details ref={menu} className="connection-status-menu">
      <summary>{indicator}</summary>
      <div className="connection-status-detail">
        <strong>{problem.title}</strong>
        <p>{problem.description}</p>
        {retry && <button onClick={retry}>Reconnect</button>}
        {problem.details && (
          <details>
            <summary>Details</summary>
            <pre>{problem.details}</pre>
          </details>
        )}
      </div>
    </details>
  );
}
