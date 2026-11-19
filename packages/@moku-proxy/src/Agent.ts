/**
 * Browser-safe messages for conversations with a coding agent through the local proxy.
 *
 * The proxy speaks the Agent Client Protocol to one agent process and condenses
 * its updates into these events, so browser code can follow a turn without
 * depending on the protocol itself.
 *
 * @example Follow a turn
 * ```ts
 * import { Schema } from "effect";
 * import * as Agent from "@moku/proxy/Agent";
 *
 * const created = await fetch("/api/agent/sessions", { method: "POST" });
 * const { sessionId } = Schema.decodeUnknownSync(Agent.Created)(await created.json());
 * const events = new EventSource(`/api/agent/sessions/${sessionId}/events`);
 * events.onmessage = ({ data }) => {
 *   const event = Schema.decodeUnknownSync(Agent.Event)(JSON.parse(data));
 *   if (event.type === "text") console.log(event.text);
 * };
 * await fetch(`/api/agent/sessions/${sessionId}/prompt`, {
 *   method: "POST",
 *   headers: { "Content-Type": "application/json" },
 *   body: JSON.stringify({ text: "Summarize this notebook." }),
 * });
 * ```
 *
 * @module
 */
import { Schema } from "effect";

/** A choice the agent offers when it asks to use a tool. */
export const PermissionOption = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** One of ACP's option kinds, such as `allow_once` or `reject_always`. */
  kind: Schema.String,
});

/** Tool progress as the agent reports it. */
export const ToolStatus = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

/**
 * One step of an agent turn.
 *
 * Events for the turn in progress are replayed to each new listener, so a
 * reconnecting view sees the whole turn. A turn ends with `stop` or `error`.
 */
export const Event = Schema.Union([
  /** Part of the agent's visible reply. */
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  /** Part of the agent's reasoning, which views may show but should not store. */
  Schema.Struct({ type: Schema.Literal("thought"), text: Schema.String }),
  /** A tool call started or changed. Later events for the same `id` replace earlier ones. */
  Schema.Struct({
    type: Schema.Literal("tool"),
    id: Schema.String,
    title: Schema.String,
    status: ToolStatus,
  }),
  /** The agent is waiting for the person to choose one of `options`. */
  Schema.Struct({
    type: Schema.Literal("permission"),
    id: Schema.String,
    title: Schema.String,
    options: Schema.Array(PermissionOption),
  }),
  /** A permission request was answered or withdrawn. */
  Schema.Struct({ type: Schema.Literal("permission-resolved"), id: Schema.String }),
  /** The turn finished. `reason` is ACP's stop reason, such as `end_turn` or `cancelled`. */
  Schema.Struct({ type: Schema.Literal("stop"), reason: Schema.String }),
  /** The turn failed or the agent process exited. */
  Schema.Struct({ type: Schema.Literal("error"), message: Schema.String }),
]);
export type Event = typeof Event.Type;

/** A model the agent can answer with. */
export const Model = Schema.Struct({
  /** The value to send when selecting this model, such as `opencode/claude-sonnet-5-5`. */
  value: Schema.String,
  /** A label for people. */
  name: Schema.String,
});
export type Model = typeof Model.Type;

/**
 * The models a session can use and the one it uses now.
 *
 * Both are empty when the agent offers no model choice, in which case it
 * answers with its own default.
 */
export const Models = Schema.Struct({
  current: Schema.NullOr(Schema.String),
  options: Schema.Array(Model),
});
export type Models = typeof Models.Type;

/**
 * The optional body of `POST /api/agent/sessions`.
 *
 * `model` overrides the proxy's configured model for the new session.
 */
export const Create = Schema.Struct({ model: Schema.optionalKey(Schema.String) });

/** The response to `POST /api/agent/sessions`. */
export const Created = Schema.Struct({
  sessionId: Schema.String,
  /** The agent's self-reported name, when it provides one. */
  agent: Schema.NullOr(Schema.String),
  /** Whether the agent received the notebook host's MCP server for editing cells. */
  notebookTools: Schema.Boolean,
  models: Models,
});
export type Created = typeof Created.Type;

/**
 * The body of `POST /api/agent/sessions/:id/model`, which responds with {@link Models}.
 *
 * The session must not be answering a prompt.
 */
export const SelectModel = Schema.Struct({ value: Schema.String });

/** The body of `POST /api/agent/sessions/:id/prompt`. */
export const Prompt = Schema.Struct({ text: Schema.String });

/** The body of `POST /api/agent/sessions/:id/permissions/:permissionId`. */
export const Answer = Schema.Struct({
  /** The chosen option, or null to decline without choosing. */
  optionId: Schema.NullOr(Schema.String),
});
