import type { ReactElement } from "react";
import type { ConsoleOutputProps } from "./types.ts";
import "./style.css";

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
