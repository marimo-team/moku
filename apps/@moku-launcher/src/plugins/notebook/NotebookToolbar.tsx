import type * as Observation from "../observation.ts";
import { ConnectionStatus } from "./ConnectionStatus.tsx";
import { ThemeSelect } from "./appearance/ThemeSelect.tsx";

interface Props {
  connection: Pick<ReturnType<typeof Observation.read>, "status" | "error" | "ready">;
  save?: { pending: boolean; disabled: boolean; onClick: () => void };
  execution?: {
    starting: boolean;
    running: boolean;
    disabled: boolean;
    onClick: () => void;
  };
}

export function NotebookToolbar({ connection, save, execution }: Props) {
  return (
    <header className="notebook-heading">
      <div className="notebook-connection">
        <ConnectionStatus
          status={connection.status}
          ready={connection.ready}
          compact
          error={connection.error ?? undefined}
        />
      </div>
      <div className="notebook-controls">
        <ThemeSelect />
        {save && (
          <button
            className="notebook-run"
            aria-label="Save notebook"
            title={save.pending ? "Saving…" : "Save notebook (⌘/Ctrl+S)"}
            aria-keyshortcuts="Control+S Meta+S"
            disabled={save.disabled}
            onClick={save.onClick}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 2h8l3 3v9H2V2h1ZM5 2v4h6V2M5 14V9h6v5" />
            </svg>
          </button>
        )}
        {execution && (
          <button
            className="notebook-run"
            aria-label={
              execution.starting
                ? "Starting kernel"
                : execution.running
                  ? "Interrupt notebook"
                  : "Run notebook"
            }
            title={
              execution.starting
                ? "Starting kernel…"
                : execution.running
                  ? "Interrupt notebook"
                  : "Run notebook"
            }
            disabled={execution.disabled}
            onClick={execution.onClick}
          >
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
              {execution.starting ? (
                <circle
                  className="kernel-spinner-stroke"
                  cx="8"
                  cy="8"
                  r="5"
                  strokeDasharray="23 9"
                />
              ) : execution.running ? (
                <rect x="4" y="4" width="8" height="8" />
              ) : (
                <path d="m5 3 7 5-7 5Z" />
              )}
            </svg>
          </button>
        )}
      </div>
    </header>
  );
}
