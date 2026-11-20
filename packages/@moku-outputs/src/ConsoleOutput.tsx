/**
 * Render text and media in the order an execution wrote them.
 *
 * @module
 */
import type * as React from "react";
import type { ConsoleOutputProps } from "./types.ts";
import { DisplayView } from "./DisplayView.tsx";
import "./style.css";

/**
 * Renders console chunks in sequence order without changing the input array.
 *
 * Text is escaped and preserved as received, including whitespace. Text chunks
 * carry their stdout or stderr channel in `data-channel`. Empty input renders
 * nothing.
 */
export function ConsoleOutput({
  chunks,
  className,
  runtimeId,
}: ConsoleOutputProps): React.ReactElement | null {
  if (chunks.length === 0) {
    return null;
  }
  const groups: React.ReactNode[] = [];
  let text: React.ReactElement[] = [];
  function flush() {
    if (!text.length) return;
    groups.push(
      <pre key={text[0].key} className="moku-console" aria-label="Console output">
        {text}
      </pre>,
    );
    text = [];
  }
  for (const { id, content } of [...chunks].sort((a, b) => a.seq - b.seq)) {
    if (content.kind === "text") {
      text.push(
        <span key={id} data-channel={content.stream}>
          {content.text}
        </span>,
      );
    } else {
      flush();
      groups.push(<DisplayView key={id} data={content.media} runtimeId={runtimeId} />);
    }
  }
  flush();
  return className ? <div className={className}>{groups}</div> : <>{groups}</>;
}
