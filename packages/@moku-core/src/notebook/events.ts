/** Observe a marimo notebook and send widget commands through its attached viewer. @module */
import { Effect, Schema, Stream } from "effect";
import { Sse } from "effect/encoding";
import { AtomRegistry } from "effect/reactivity";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { CommError } from "../experimental/Comm.ts";
import { LegacyCommApi } from "../internal/comm-protocol.ts";
import type * as Host from "../Host.ts";
import type { CommRequest, ModelError } from "../internal/client.ts";
import { NotebookEvent } from "../internal/api.ts";
import type * as Protocol from "../Protocol.ts";
import type { NotebookState } from "./state.ts";

/** A notebook event with the identity of the viewer that received a widget notification. */
export type Event = typeof NotebookEvent.Type & { readonly sessionId?: string };

/** A decoded event and the notebook state to which it applies. */
export interface Update {
  /** State after applying the event. */
  readonly state: NotebookState;
  /** Absent when the notebook starts a fresh snapshot. */
  readonly event?: Event;
}

interface Identity {
  readonly sessionId: string;
  readonly runtimeId: string;
}

const Frame = Schema.Struct({
  event: Schema.String,
  id: Schema.optionalKey(Schema.String),
  data: Schema.fromJsonString(Schema.Json),
}).pipe(Schema.decodeTo(NotebookEvent));

/** The marimo session route and catalog used to resolve notebook paths. */
export interface Options {
  readonly baseUrl: URL;
  /** Supplies project roots for relative notebook paths. */
  readonly catalog: Host.Interface["state"];
}

const problem = (code: CommError["code"], message: string) =>
  new CommError({ code, message });
const failure = (cause: unknown) =>
  cause instanceof CommError
    ? cause
    : new CommError({
        code: "transport",
        message: "The output connection failed.",
        cause,
      });

/** Open a marimo viewer on the notebook stream and address widget requests to its session. */
export const session = Effect.fnUntraced(function* (
  options: Options,
  withSnapshot: (
    stream: Stream.Stream<Event, CommError>,
  ) => Effect.Effect<never, CommError | ModelError>,
) {
  const registry = yield* AtomRegistry.AtomRegistry;
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest(
      HttpClientRequest.prependUrl(options.baseUrl.href.replace(/\/$/, "")),
    ),
    HttpClient.withScope,
    HttpClient.transformResponse(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.succeed(response)
          : Effect.fail(
              response.status === 401
                ? problem(
                    "authentication",
                    "Authorize interactions with the marimo server token.",
                  )
                : problem(
                    "transport",
                    `Marimo refused the output request (${response.status}).`,
                  ),
            ),
      ),
    ),
  );
  const client = yield* HttpApiClient.makeWith(LegacyCommApi, { httpClient: http });

  const filePath = Effect.fnUntraced(function* (
    notebook: typeof Protocol.Notebook.Type,
  ) {
    if (notebook.path === null)
      return yield* problem(
        "unsupported",
        "Opening a marimo session requires a notebook file path.",
      );
    if (/^(\/|[A-Za-z]:[\\/])/.test(notebook.path)) return notebook.path;
    const catalog = yield* AtomRegistry.getResult(registry, options.catalog, {
      suspendOnWaiting: true,
    }).pipe(
      Effect.mapError(() => problem("unavailable", "The host catalog is unavailable.")),
    );
    const root = catalog.projects[notebook.project_id]?.root;
    if (!root)
      return yield* problem("unavailable", "The notebook's project is unavailable.");
    const separator = root.includes("\\") ? "\\" : "/";
    return (
      root.replace(/[\\/]$/, "") + separator + notebook.path.replaceAll("/", separator)
    );
  });

  function viewer(
    notebookId: typeof Protocol.NotebookId.Type,
    session: Identity,
    file: string,
  ) {
    return Stream.unwrap(
      Effect.gen(function* () {
        const response = yield* http.get("/sse", {
          urlParams: { file, session_id: session.sessionId },
          headers: { Accept: "text/event-stream" },
        });
        if (
          response.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
          "text/event-stream"
        )
          return yield* problem(
            "transport",
            "Marimo did not return a notebook event stream.",
          );
        let confirmedNotebook = false;
        let confirmedRuntime = false;
        return response.stream.pipe(
          Stream.timeout("45 seconds"),
          Stream.decodeText,
          Stream.pipeThroughChannel(Sse.decodeSchema(Frame)),
          Stream.mapEffect(
            Effect.fnUntraced(function* (event) {
              if (event.event === "close")
                return yield* new CommError({
                  code: "unavailable",
                  message: "The marimo session closed.",
                });
              if (!("_tag" in event)) {
                if (event.event === "notebook")
                  confirmedNotebook = event.data.notebook.id === notebookId;
                if (event.event === "runtime")
                  confirmedRuntime =
                    event.data.runtime.id === session.runtimeId &&
                    event.data.runtime.notebook_id === notebookId &&
                    event.data.runtime.state.status === "ready";
                if (
                  (event.event === "notebook" && !confirmedNotebook) ||
                  (event.event === "runtime" && !confirmedRuntime) ||
                  (event.event === "marimo" &&
                    !(confirmedNotebook && confirmedRuntime)) ||
                  ["reset", "notebook.removed", "runtime.removed"].includes(event.event)
                )
                  return yield* new CommError({
                    code: "stale-runtime",
                    message:
                      "The output connection belongs to a different notebook or runtime.",
                  });
                if (event.event === "marimo")
                  return { ...event, sessionId: session.sessionId };
              }
              return event;
            }),
          ),
        );
      }),
    ).pipe(Stream.mapError(failure));
  }

  const open = Effect.fnUntraced(function* (
    current: Identity,
    notebook: typeof Protocol.Notebook.Type,
  ) {
    yield* client
      .authorize({ payload: {} })
      .pipe(Effect.mapError(failure), Effect.scoped);
    const file = yield* filePath(notebook);
    return yield* withSnapshot(viewer(notebook.id, current, file)).pipe(
      Effect.mapError(failure),
    );
  });

  const post = Effect.fnUntraced(
    function* (sessionId: string, command: CommRequest) {
      const { payload: input } = command;
      const headers = { sessionId, ...command.headers };
      switch (input._tag) {
        case "SetValues":
          yield* client.setValues({
            headers,
            payload: {
              objectIds: Object.keys(input.values),
              values: Object.values(input.values),
            },
          });
          break;
        case "Model":
          yield* client.setModel({
            headers,
            payload: {
              modelId: input.model,
              message: input.message,
              buffers: input.buffers,
            },
          });
          break;
        case "Invoke":
          yield* client.invoke({
            headers,
            payload: {
              functionCallId: input.call,
              namespace: input.namespace,
              functionName: input.name,
              args: input.args,
            },
          });
          break;
      }
    },
    Effect.mapError(failure),
    Effect.scoped,
  );
  return { open, post };
});

/** Commands bound to the viewer supplying the notebook stream. */
export type Session = Effect.Success<ReturnType<typeof session>>;
