interface Props {
  name: string;
  runId?: string;
  statusLabel: string;
  active: boolean;
  starting: boolean;
  actionKind: "run" | "cancel";
  actionLabel: string;
  disabledReason: string;
  onAction: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function GraphToolbar({
  name,
  runId,
  statusLabel,
  active,
  starting,
  actionKind,
  actionLabel,
  disabledReason,
  onAction,
  expanded,
  onToggleExpanded,
}: Props) {
  return (
    <header className="run-header">
      <div className="run-name">
        <strong>{name.replace(/\.py$/, "")}</strong>
        <span>
          {runId ? `Run ${runId.replace(/^run-/, "").slice(0, 8)}` : "No run yet"}
        </span>
      </div>
      <div className="run-tools">
        <span className={`run-status ${statusLabel}`}>
          {(active || starting) && <i className="spinner" />}
          {statusLabel}
        </span>
        <button
          className="run-button"
          disabled={!!disabledReason}
          onClick={onAction}
          title={disabledReason || `${actionLabel} notebook`}
          aria-label={
            disabledReason
              ? `${actionLabel}: ${disabledReason}`
              : `${actionLabel} notebook`
          }
        >
          {starting ? (
            <i className="spinner" />
          ) : (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {actionKind === "cancel" ? (
                <rect x="4" y="4" width="8" height="8" />
              ) : (
                <path d="m5 3 7 5-7 5Z" />
              )}
            </svg>
          )}{" "}
          <span>{actionLabel}</span>
        </button>
        <button
          className="icon-button"
          title={expanded ? "Exit expanded view" : "Expand view"}
          aria-label="Expand view"
          onClick={onToggleExpanded}
        >
          ⤢
        </button>
      </div>
    </header>
  );
}
