import { Stream } from "effect";
import { HttpServerResponse } from "effect/http";

import type * as Notebook from "../src/Notebook.ts";
import type * as Protocol from "../src/Protocol.ts";

export function emptyState(): Notebook.State {
  return {
    notebook: null,
    document: null,
    runtime: null,
    analysis: null,
    runs: {},
    executions: {},
    consoles: {},
    outputs: {},
    variables: {},
    inputs: {},
  };
}

/** Serves a notebook snapshot and keeps the event stream open for live updates. */
export function notebookEvents(notebook: typeof Protocol.Notebook.Encoded) {
  const snapshot = `event: notebook\ndata: ${JSON.stringify({ notebook })}\n\nevent: ready\nid: 1\ndata: {}\n\n`;
  return HttpServerResponse.stream(
    Stream.succeed(snapshot).pipe(Stream.encodeText, Stream.concat(Stream.never)),
    { contentType: "text/event-stream" },
  );
}
