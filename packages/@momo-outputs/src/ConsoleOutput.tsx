/**
 * Render console chunks as ordered text with stdout and stderr channels.
 *
 * @module
 */
import type { ReactElement } from "react";
import type { ConsoleOutputProps } from "./types.ts";
import "./style.css";

/**
 * Renders console chunks in sequence order without changing the input array.
 *
 * Text is escaped and preserved as received, including whitespace. Each chunk
 * retains its stdout or stderr channel in `data-channel`. Empty input renders
 * nothing.
 */
export function ConsoleOutput({
  chunks,
  className,
}: ConsoleOutputProps): ReactElement | null {
  if (chunks.length === 0) {
    return null;
  }
  const ordered = [...chunks].sort((a, b) => a.seq - b.seq);

  return (
    <pre
      className={["momo-console", className].filter(Boolean).join(" ")}
      aria-label="Console output"
    >
      {ordered.map((chunk) => (
        <span key={chunk.id} data-channel={chunk.name}>
          {chunk.text}
        </span>
      ))}
    </pre>
  );
}
