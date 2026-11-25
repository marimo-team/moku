/**
 * Debug: a Claude agent that works inside the notebook's running kernel with marimo-pair, to fix
 * whatever is wrong. The person starts it from the status bar; the board also starts it on its
 * own when cells fail, so nobody has to chase errors.
 *
 * The dev server's `/__sketcher/debug` route (`vite/debugBridge.ts`)
 * runs the agent and streams what it does as JSON lines.
 *
 * @module
 */

/** A cell that fails, and how. */
export interface CellError {
  readonly cell: string;
  readonly error: string;
}

interface DebugRequest {
  /** The notebook's path, as moku knows it. */
  readonly path: string;
  readonly note: string;
  readonly errors: readonly CellError[];
  /** Started by the board for failing cells, rather than by the person. */
  readonly auto: boolean;
}

/** One line of the route's response. */
type DebugEvent =
  | { readonly type: "status" | "text" | "tool"; readonly text: string }
  | {
      readonly type: "done";
      readonly ok: boolean;
      readonly summary: string;
      readonly seconds: number;
    };

/** Runs the agent, calling `onEvent` as it goes. Resolves with the final event. */
export type DebugTransport = (
  request: DebugRequest,
  signal: AbortSignal,
  onEvent: (event: DebugEvent) => void,
) => Promise<Extract<DebugEvent, { type: "done" }>>;

export const fetchDebug: DebugTransport = async (request, signal, onEvent) => {
  const response = await fetch("/__sketcher/debug", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (response.status === 404 || !response.body) {
    return {
      type: "done",
      ok: false,
      seconds: 0,
      summary:
        "This dev server has no /__sketcher/debug route. Start it with `bun dev`, which installs the Drawing view's Vite plugin.",
    };
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let done: Extract<DebugEvent, { type: "done" }> | null = null;
  for (;;) {
    const { value, done: ended } = await reader.read();
    if (ended) break;
    buffer += value;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as DebugEvent;
      if (event.type === "done") done = event;
      else onEvent(event);
    }
  }
  return (
    done ?? {
      type: "done",
      ok: false,
      seconds: 0,
      summary: "The debug run stopped without an answer.",
    }
  );
};

/** What the Debug panel shows. */
export type DebugState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "running" | "done" | "failed" | "stopped";
      readonly auto: boolean;
      /** What it was asked to look at: the note, or the failing cells. */
      readonly about: string;
      readonly steps: readonly string[];
      readonly summary: string | null;
    };

/** A run, as the panel shows it. */
export type DebugRun = Exclude<DebugState, { readonly kind: "idle" }>;

/** How often the board fixes the same cell on its own before leaving it to the person. */
export const AUTO_ATTEMPTS = 2;

/**
 * Which failing cells the board should send the agent on its own: new failures (a cell, its code
 * and its error not seen before) of cells it hasn't already tried too often.
 */
export function autoTargets(
  errors: readonly (CellError & { readonly code: string })[],
  seen: ReadonlySet<string>,
  attempts: ReadonlyMap<string, number>,
): (CellError & { readonly key: string })[] {
  return errors.flatMap((e) => {
    const key = `${e.cell}\u0000${e.code}\u0000${e.error}`;
    if (seen.has(key) || (attempts.get(e.cell) ?? 0) >= AUTO_ATTEMPTS) return [];
    return [{ cell: e.cell, error: e.error, key }];
  });
}
