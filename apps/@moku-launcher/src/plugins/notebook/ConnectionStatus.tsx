import { Cause } from "effect";
import { AsyncResult } from "effect/reactivity";
import * as Problems from "./feedback/problems.ts";
import * as React from "react";

export function ConnectionStatus({
  result,
  compact = false,
  retry,
}: {
  result: AsyncResult.AsyncResult<unknown, unknown>;
  compact?: boolean;
  retry?: () => void;
}) {
  const menu = React.useRef<HTMLDetailsElement>(null);
  React.useEffect(() => {
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
  const problem = AsyncResult.isFailure(result)
    ? Problems.describe(Cause.squash(result.cause))
    : undefined;
  const live = AsyncResult.isSuccess(result) && !result.waiting;
  const label =
    problem?.title ??
    (live
      ? "Live"
      : !AsyncResult.isInitial(result) && result.waiting
        ? "Reconnecting…"
        : "Connecting…");
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
