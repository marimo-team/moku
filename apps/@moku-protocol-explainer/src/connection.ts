/** A replayable first connection using the pinned protocol's record shapes. @module */
import type * as Protocol from "@marimo-team/client/protocol";

/** The object kinds followed by this lesson's filtered notebook stream. */
export type RecordEvent =
  | Protocol.NotebookEvent
  | Protocol.CellEvent
  | Protocol.DocumentEvent;
/** A snapshot record or its completion marker. */
export type Message = RecordEvent | Protocol.ReadyEvent;

const config = {
  column: null,
  disabled: false,
  hide_code: false,
  expand_output: false,
};
const notebook: Protocol.Notebook = {
  id: "n1",
  project_id: "p1",
  path: "hello.py",
  name: "hello",
  operations: ["notebook.edit", "notebook.save", "runtime.start"],
  modified_at: "2026-10-01T09:00:00Z",
};
const first: Protocol.Cell = {
  id: "c1",
  notebook_id: "n1",
  code: "x = 10",
  name: "_",
  config,
  etag: "cell-a-v1",
  code_fingerprint: "code-a-v1",
  version: 1,
};
const second: Protocol.Cell = {
  id: "c2",
  notebook_id: "n1",
  code: "print(x)",
  name: "_",
  config,
  etag: "cell-b-v1",
  code_fingerprint: "code-b-v1",
  version: 1,
};
const document: Protocol.Document = {
  notebook_id: "n1",
  order: ["c1", "c2"],
  app_config: {},
  version: 1,
  etag: "document-v1",
  saved_etag: "document-v1",
  order_etag: "order-v1",
  app_config_etag: "config-v1",
};

/** Records constructed by this host before it publishes a snapshot. */
export const initialRecords: readonly RecordEvent[] = [
  { event: "notebook", data: { notebook } },
  { event: "cell", data: { cell: first } },
  { event: "cell", data: { cell: second } },
  { event: "document", data: { document } },
];
/** A consistent snapshot with no runtime or retained results. */
export const snapshot: readonly Message[] = [
  ...initialRecords,
  { event: "ready", id: "snapshot:7fa2", data: {} },
];

/** The actual request is illustrated, never sent to a real host. */
export const request = {
  method: "GET",
  path: "/api/marimo/v1/notebooks/n1/events?types=notebook,cell,document",
  headers: { Accept: "text/event-stream", Authorization: "Bearer <host token>" },
};

/** Source for two cells, with the second depending on x from the first. */
export const source = `import marimo

app = marimo.App()

@app.cell
def _():
    x = 10
    return (x,)

@app.cell
def _(x):
    print(x)
    return

if __name__ == "__main__":
    app.run()
`;

/** One meaningful stop in the connection walkthrough. */
export interface Step {
  /** A concise explanation of the visible change. */
  readonly title: string;
  /** Explanation while approaching this stop. */
  readonly moving: string;
  /** Present only when this stop delivers a protocol message. */
  readonly message?: Message;
  /** Records constructed together when parsing completes at this stop. */
  readonly created?: readonly RecordEvent[];
  /** Pause so the learner can inspect the host before snapshot delivery. */
  readonly breakpoint?: boolean;
}

/** A single file-backed host strategy, not a mandatory protocol loading order. */
export const steps: readonly Step[] = [
  {
    title: "Saved source is in storage. The host has not loaded the notebook yet.",
    moving: "Saved source is in storage. The host has not loaded the notebook yet.",
  },
  {
    title: "The request reaches the host.",
    moving: "The client sends GET /events to the host.",
  },
  {
    title: "The streaming response is open. This connection will stay here.",
    moving: "The host opens a streaming response back to the client.",
  },
  {
    title:
      "Loaded from storage: the notebook, document, and cells now live in host memory.",
    moving: "Read hello.py from storage → parse → create the in-memory objects.",
    created: initialRecords,
    breakpoint: true,
  },
  {
    title: "The event is gone. Its notebook record remains in the client.",
    moving: "A notebook event carries a copy across the open connection.",
    message: snapshot[0],
  },
  {
    title: "Both sides now hold cell c1. The host kept its original.",
    moving: "A cell event carries c1 to the client over the same connection.",
    message: snapshot[1],
  },
  {
    title: "The client now has both cells. Neither has run yet.",
    moving: "Another cell event carries c2, with source print(x).",
    message: snapshot[2],
  },
  {
    title: "The document orders c1 before c2 in the client’s notebook.",
    moving: "A document event delivers the cell order and revision.",
    message: snapshot[3],
  },
  {
    title: "The snapshot is complete. The connection stays open for changes.",
    moving: "The host sends ready to mark the end of the snapshot.",
    message: snapshot[4],
  },
];

/** State shown at one position, including incomplete snapshot records. */
export interface Scene {
  readonly step: Step;
  readonly index: number;
  readonly hostLoaded: boolean;
  /** The HTTP streaming response remains open after ready. */
  readonly connectionOpen: boolean;
  readonly hostRecords: readonly RecordEvent[];
  readonly received: readonly RecordEvent[];
  readonly delivered: readonly Message[];
  readonly ready: boolean;
  /** Null until ready supplies a resumable position. */
  readonly cursor: string | null;
}

/** Reconstructs a scene from the beginning, clamping to a valid timeline stop. */
export function sceneAt(position: number): Scene {
  const index = Number.isFinite(position)
    ? Math.max(0, Math.min(steps.length - 1, Math.trunc(position)))
    : 0;
  const delivered = steps
    .slice(0, index + 1)
    .flatMap((step) => (step.message ? [step.message] : []));
  const ready = delivered.find((message) => message.event === "ready");
  const hostRecords = steps.slice(0, index + 1).flatMap((step) => step.created ?? []);
  return {
    index,
    step: steps[index],
    connectionOpen: index >= 2,
    hostLoaded: hostRecords.length === initialRecords.length,
    hostRecords,
    delivered,
    received: delivered.filter(
      (message): message is RecordEvent => message.event !== "ready",
    ),
    ready: ready !== undefined,
    cursor: ready?.id ?? null,
  };
}

/** Stable identity used to link cards on both sides of the stream. */
export function recordKey(message: RecordEvent): string {
  switch (message.event) {
    case "notebook":
      return `notebook:${message.data.notebook.id}`;
    case "cell":
      return `cell:${message.data.cell.id}`;
    case "document":
      return `document:${message.data.document.notebook_id}`;
  }
}

/** Formats the event as a server-sent event frame for inspection. */
export function frame(message: Message): string {
  return `${message.id === undefined ? "" : `id: ${message.id}\n`}event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`;
}

/** A transient storage operation or protocol handoff between timeline stops. */
export type Transit =
  | { readonly kind: "request"; readonly progress: number }
  | { readonly kind: "open"; readonly progress: number }
  | { readonly kind: "load"; readonly progress: number }
  | { readonly kind: "event"; readonly progress: number; readonly message: Message };

/** Returns the message in flight; settled timeline stops have no transit object. */
export function transitAt(position: number): Transit | null {
  const index = Math.floor(position);
  const progress = position - index;
  if (
    !Number.isFinite(position) ||
    index < 0 ||
    index >= steps.length - 1 ||
    progress === 0
  )
    return null;
  if (index === 0) return { kind: "request", progress };
  if (index === 1) return { kind: "open", progress };
  if (steps[index + 1].created) return { kind: "load", progress };
  const message = steps[index + 1].message;
  return message ? { kind: "event", progress, message } : null;
}
