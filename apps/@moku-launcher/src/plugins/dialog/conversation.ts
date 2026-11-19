/**
 * A notebook's conversation with the agent behind the local proxy.
 *
 * Each prompt becomes a new dialog cell at the end of the notebook holding one
 * turn. The prompt is written when it is sent and the reply when the turn ends,
 * then the cell runs so every client renders the same transcript. The agent
 * works in the cells after it, and the next prompt continues below them.
 *
 * Agent sessions are only a cache of the conversation. The session that
 * answered the last turn is reused for the next one, and otherwise a new
 * session receives the turns above, so a reordered or reopened notebook
 * continues where it left off.
 *
 * @module
 */
import { Cause, Data, Effect, Option, Predicate, Schema } from "effect";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Agent from "@moku/proxy/Agent";
import type * as Notebook from "@moku/core/Notebook";
import type * as Document from "@moku/editor/Document";
import * as Prompt from "./prompt.ts";
import * as Thread from "./thread.ts";
import * as Transcript from "./transcript.ts";

/** A tool call in the current turn. */
export interface Tool {
  readonly id: string;
  readonly title: string;
  readonly status: typeof Agent.ToolStatus.Type;
}

/** A question from the agent that the person must answer before it continues. */
export type Permission = Extract<Agent.Event, { type: "permission" }>;

/** Progress of the turn in flight, which is shown but never stored. */
export interface Live {
  /** The dialog cell of the turn in flight, or of the last turn that failed. */
  readonly turn: string | null;
  readonly reply: string;
  readonly thought: string;
  readonly tools: readonly Tool[];
  readonly permissions: readonly Permission[];
  /** Why the last turn failed, cleared by the next message. */
  readonly error: string | null;
}

/** The dialog could not reach the agent or update its cell. */
export class DialogError extends Data.TaggedError("DialogError")<{
  readonly message: string;
  readonly status?: number;
}> {}

const idle: Live = {
  turn: null,
  reply: "",
  thought: "",
  tools: [],
  permissions: [],
  error: null,
};
const decodeEvent = Schema.decodeUnknownOption(Schema.fromJsonString(Agent.Event));
const decodeCreated = Schema.decodeUnknownOption(Agent.Created);
const decodeModels = Schema.decodeUnknownOption(Agent.Models);
const failure = Schema.decodeUnknownOption(Schema.Struct({ error: Schema.String }));

// One model choice serves every notebook, so the picker follows the person around.
const modelKey = "moku:dialog:model";
function storedModel(): string | null {
  try {
    return globalThis.localStorage?.getItem(modelKey) ?? null;
  } catch {
    return null;
  }
}
function storeModel(value: string | null) {
  try {
    if (value === null) globalThis.localStorage?.removeItem(modelKey);
    else globalThis.localStorage?.setItem(modelKey, value);
  } catch {
    // Storage can be unavailable, in which case the choice lasts for this page.
  }
}

const post = Effect.fnUntraced(function* (path: string, body?: unknown) {
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(`/api/agent${path}`, {
        method: "POST",
        credentials: "same-origin",
        headers:
          body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      }),
    catch: () => new DialogError({ message: "Could not reach the local proxy." }),
  });
  const json: unknown = yield* Effect.promise(() => response.json().catch(() => null));
  if (!response.ok)
    return yield* new DialogError({
      message: Option.match(failure(json), {
        onNone: () => `The agent request failed (${response.status}).`,
        onSome: (problem) => problem.error,
      }),
      status: response.status,
    });
  return json;
});

function make(notebook: Notebook.Interface, document: Document.Interface) {
  const registry = document.registry;
  const live = Atom.make(idle).pipe(Atom.keepAlive);
  const message = Atom.make("").pipe(Atom.keepAlive);
  const model = Atom.make<string | null>(storedModel()).pipe(Atom.keepAlive);
  const agent = Atom.make<{
    readonly name: string | null;
    readonly models: Agent.Models;
  } | null>(null).pipe(Atom.keepAlive);
  // Each session is filed under the turn it answered last, so only a turn that
  // continues from that one reuses it.
  const sessions = new Map<string, Agent.Created>();
  let active: Agent.Created | undefined;
  // A session started only to list models, kept for the next turn that needs a new one.
  let spare: Agent.Created | undefined;

  const update = (f: (live: Live) => Live) => registry.update(live, f);
  const current = () => registry.get(document.state).document;
  const commit = (id: string, turn: Transcript.Turn) =>
    document.edit((edit) => edit.setCode(id, Transcript.serialize(turn)));

  // Run only the dialog cell, so the transcript renders without touching the agent's work.
  const render = (id: string) =>
    Effect.gen(function* () {
      yield* document.flush;
      yield* notebook.ensureRunning;
      const confirmed = yield* document.flush;
      const cell = confirmed.cells.find((cell) => cell.id === id);
      if (cell) yield* notebook.runtime.run({ cells: [cell] });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new DialogError({
            message:
              Predicate.hasProperty(cause, "message") &&
              Predicate.isString(cause.message)
                ? `Could not run the dialog: ${cause.message}`
                : "Could not run the dialog.",
          }),
      ),
    );

  function apply(event: Agent.Event) {
    update((current) => {
      switch (event.type) {
        case "text":
          return { ...current, reply: current.reply + event.text };
        case "thought":
          return { ...current, thought: current.thought + event.text };
        case "tool": {
          const previous = current.tools.find((tool) => tool.id === event.id);
          const tool = { ...event, title: event.title || previous?.title || "Tool" };
          return {
            ...current,
            tools: previous
              ? current.tools.map((entry) => (entry.id === event.id ? tool : entry))
              : [...current.tools, tool],
          };
        }
        case "permission":
          return { ...current, permissions: [...current.permissions, event] };
        case "permission-resolved":
          return {
            ...current,
            permissions: current.permissions.filter(
              (permission) => permission.id !== event.id,
            ),
          };
        default:
          return current;
      }
    });
  }

  // Follow the turn until it stops. Events replay from the turn's start on each
  // connection, so a reconnect rebuilds progress instead of duplicating it.
  const follow = (sessionId: string) =>
    Effect.callback<string, DialogError>((resume) => {
      const source = new EventSource(
        `/api/agent/sessions/${encodeURIComponent(sessionId)}/events`,
      );
      source.onopen = () =>
        update((current) => ({
          ...current,
          reply: "",
          thought: "",
          tools: [],
          permissions: [],
        }));
      source.onmessage = ({ data }) => {
        const event = decodeEvent(data);
        if (Option.isNone(event)) return;
        apply(event.value);
        if (event.value.type === "stop") resume(Effect.succeed(event.value.reason));
        if (event.value.type === "error")
          resume(Effect.fail(new DialogError({ message: event.value.message })));
      };
      source.onerror = () => {
        if (source.readyState === EventSource.CLOSED)
          resume(Effect.fail(new DialogError({ message: "The agent session ended." })));
      };
      return Effect.sync(() => source.close());
    });

  const connect = Effect.gen(function* () {
    if (spare) {
      const session = spare;
      spare = undefined;
      return session;
    }
    const chosen = registry.get(model);
    const created = decodeCreated(
      yield* post("/sessions", chosen === null ? undefined : { model: chosen }),
    );
    if (Option.isNone(created))
      return yield* new DialogError({
        message: "The proxy returned an invalid session.",
      });
    registry.set(agent, { name: created.value.agent, models: created.value.models });
    return created.value;
  });

  // Continue the session that answered the previous turn, or start one that
  // receives the turns above.
  const prompt = Effect.fnUntraced(function* (input: {
    readonly id: string;
    readonly text: string;
    readonly history: readonly Thread.Entry[];
  }) {
    const path = AsyncResult.getOrElse(registry.get(notebook.state), () => undefined)
      ?.notebook?.path;
    const send = (session: Agent.Created, fresh: boolean) =>
      post(`/sessions/${encodeURIComponent(session.sessionId)}/prompt`, {
        text: Prompt.compose({
          text: input.text,
          notebookPath: path ?? null,
          cellId: input.id,
          history: fresh ? input.history.map((entry) => entry.turn) : null,
          notebookTools: session.notebookTools,
        }),
      });
    const previous = input.history.at(-1)?.id;
    const existing = previous === undefined ? undefined : sessions.get(previous);
    if (previous !== undefined) sessions.delete(previous);
    if (existing) {
      active = existing;
      const reused = yield* send(existing, false).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) => error.status === 410,
          () => Effect.succeed(false),
        ),
      );
      if (reused) return existing;
    }
    const created = yield* connect;
    active = created;
    yield* send(created, true);
    return created;
  });

  /**
   * Names of cells, other than dialogs, whose source differs from `before`.
   *
   * Names are saved in the file while ids are not, so unnamed cells fall back
   * to their id only for the current session.
   */
  const changed = (before: ReadonlyMap<string, string | null>) =>
    [...(current()?.cells.values() ?? [])]
      .filter(
        (cell) => !Transcript.isDialog(cell.code) && before.get(cell.id) !== cell.code,
      )
      .map((cell) => (cell.name && cell.name !== "_" ? cell.name : cell.id));

  const ask = Atom.fn((text: string) => {
    let turn: { id: string; prompt: string } | undefined;
    // Set once the reply is stored, so a later failure does not store it twice.
    let answered = false;
    return Effect.gen(function* () {
      const snapshot = current();
      if (!snapshot)
        return yield* new DialogError({ message: "The notebook is still loading." });
      // Turns are append-only, so each one continues every turn above it.
      const after = snapshot.order.at(-1) ?? null;
      const history = Thread.above(snapshot, after);
      let created: string | undefined;
      document.edit((edit) => {
        created = edit.createCell(
          {
            code: Transcript.serialize({ prompt: text, reply: "" }),
            config: { hide_code: true },
          },
          after === null ? undefined : { after },
        );
      });
      if (created === undefined)
        return yield* new DialogError({ message: "Could not add the dialog cell." });
      const id: string = created;
      turn = { id, prompt: text };
      update(() => ({ ...idle, turn: id }));
      const before = new Map(
        [...(current()?.cells.values() ?? [])].map((cell) => [cell.id, cell.code]),
      );
      yield* render(id);
      const session = yield* prompt({ id, text, history });
      const reason = yield* follow(session.sessionId).pipe(
        Effect.onInterrupt(() =>
          post(`/sessions/${encodeURIComponent(session.sessionId)}/cancel`).pipe(
            Effect.ignore,
          ),
        ),
      );
      const reply = registry.get(live).reply.trim();
      const stopped =
        reason === "end_turn" ? "" : `\n\n*Stopped: ${reason.replaceAll("_", " ")}.*`;
      const touched = changed(before);
      commit(id, {
        prompt: text,
        reply: (reply || "*No reply.*") + stopped,
        ...(touched.length ? { cells: touched } : {}),
      });
      answered = true;
      sessions.set(id, session);
      active = undefined;
      // Keep showing the streamed reply until the stored one renders in its place.
      yield* render(id);
      update(() => idle);
    }).pipe(
      Effect.tapCause((cause) =>
        Effect.gen(function* () {
          active = undefined;
          const squashed = Cause.squash(cause);
          const message = Cause.hasInterruptsOnly(cause)
            ? "The dialog was closed before the agent finished."
            : squashed instanceof Error
              ? squashed.message
              : "The dialog failed.";
          if (!Cause.hasInterruptsOnly(cause)) console.error(Cause.pretty(cause));
          if (!turn) return update(() => ({ ...idle, error: message }));
          const reply = registry.get(live).reply.trim();
          const failed = turn;
          update(() => ({ ...idle, turn: failed.id, error: message }));
          if (answered) return;
          // Keep a partial answer so the person can see what the agent did before failing.
          commit(failed.id, {
            prompt: failed.prompt,
            reply: `${reply ? `${reply}\n\n` : ""}*Interrupted: ${message}*`,
          });
          yield* render(failed.id).pipe(Effect.ignore);
        }),
      ),
    );
  }).pipe(Atom.keepAlive);

  const cancel = Atom.fn(() =>
    active
      ? post(`/sessions/${encodeURIComponent(active.sessionId)}/cancel`).pipe(
          Effect.asVoid,
        )
      : Effect.void,
  );

  const answer = Atom.fn(
    (input: { readonly id: string; readonly optionId: string | null }) =>
      active
        ? post(
            `/sessions/${encodeURIComponent(active.sessionId)}/permissions/${input.id}`,
            { optionId: input.optionId },
          ).pipe(Effect.asVoid)
        : Effect.void,
  );

  // Starting a session is the only way to learn which models the agent offers.
  const loadModels = Atom.fn(() =>
    registry.get(agent) !== null || spare
      ? Effect.void
      : connect.pipe(
          Effect.tap((session) =>
            Effect.sync(() => {
              spare = session;
            }),
          ),
          Effect.asVoid,
        ),
  );

  const selectModel = Atom.fn((value: string | null) =>
    Effect.gen(function* () {
      registry.set(model, value);
      storeModel(value);
      // Sessions keep the model they started with, so later turns start fresh
      // sessions that receive the conversation so far.
      sessions.clear();
      const session = spare;
      if (!session || value === null) {
        spare = undefined;
        return;
      }
      const models = decodeModels(
        yield* post(`/sessions/${encodeURIComponent(session.sessionId)}/model`, {
          value,
        }),
      );
      if (Option.isSome(models))
        registry.update(
          agent,
          (current) => current && { ...current, models: models.value },
        );
    }),
  );

  return {
    /** Progress of the turn in flight. */
    live: live as Atom.Atom<Live>,
    /** The unsent message. */
    message,
    /**
     * The model chosen for new sessions, or null for the proxy's configured default.
     *
     * The choice is stored in the browser and shared by every notebook.
     */
    model: model as Atom.Atom<string | null>,
    /** The agent's name and models, known once a session has started. */
    agent: agent as Atom.Atom<{
      readonly name: string | null;
      readonly models: Agent.Models;
    } | null>,
    /** Starts a session ahead of the next turn so the agent's models can be listed. */
    loadModels,
    /** Chooses the model for the next turn, or null for the proxy's default. */
    selectModel,
    /** Adds a turn at the end of the notebook and resolves when the agent's reply is stored. */
    ask,
    /** Asks the agent to stop the current turn. */
    cancel,
    /** Answers a permission request, or declines it when `optionId` is null. */
    answer,
  };
}

export type Interface = ReturnType<typeof make>;

// Conversations live as long as their document, so a turn survives re-renders.
const conversations = new WeakMap<Document.Interface, Interface>();

/** The conversation in one notebook document, shared by every view that shows it. */
export function forNotebook(
  notebook: Notebook.Interface,
  document: Document.Interface,
): Interface {
  let conversation = conversations.get(document);
  if (!conversation)
    conversations.set(document, (conversation = make(notebook, document)));
  return conversation;
}
