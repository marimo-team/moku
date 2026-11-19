/**
 * Serve browser conversations from one Agent Client Protocol process.
 *
 * @module
 */
import * as Acp from "@agentclientprotocol/sdk";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import type * as NodeHttp from "node:http";
import * as NodeReadline from "node:readline";
import * as NodeStream from "node:stream";
import { Option, Schema } from "effect";
import * as Agent from "../Agent.ts";
import { json, readBody } from "./http.ts";

/** A command that starts an agent speaking ACP over standard input and output. */
export interface AgentOptions {
  readonly command: string;
  readonly args?: readonly string[];
  /** The agent's working directory and session root. Must be absolute. */
  readonly cwd: string;
  /** Overrides inherited environment variables. */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Selects a model through each session's ACP model option, such as
   * `opencode/claude-sonnet-5-5`. The agent's own default applies when unset or
   * when the agent offers no model option.
   */
  readonly model?: string;
}

interface Context {
  /** The notebook host's streamable HTTP MCP endpoint, when one is running. */
  readonly mcp: () => string | undefined;
  readonly log: (message: string) => void;
}

interface Session {
  /** Events for the current turn, replayed to listeners that connect mid-turn. */
  turn: Agent.Event[];
  /** The id of the agent's model option, when it offers one. */
  readonly modelOption: string | undefined;
  models: Agent.Models;
  readonly listeners: Set<(event: Agent.Event) => void>;
  readonly permissions: Map<string, (outcome: Acp.RequestPermissionOutcome) => void>;
  prompting: boolean;
}

interface Process {
  readonly child: NodeChildProcess.ChildProcess;
  readonly connection: Acp.ClientConnection;
  readonly initialized: Acp.InitializeResponse;
}

const promptLimit = 1_048_576;
const cancelled: Acp.RequestPermissionOutcome = { outcome: "cancelled" };

function emit(session: Session, event: Agent.Event) {
  session.turn.push(event);
  for (const listener of session.listeners) listener(event);
}

const noModels: Agent.Models = { current: null, options: [] };

function modelOption(options: readonly Acp.SessionConfigOption[] | null | undefined) {
  return options?.find(
    (option): option is Extract<Acp.SessionConfigOption, { type: "select" }> =>
      option.category === "model" && option.type === "select",
  );
}

/** Reads the model choice from a session's options, flattening grouped values. */
function models(options: readonly Acp.SessionConfigOption[] | null | undefined) {
  const option = modelOption(options);
  if (!option) return noModels;
  return {
    current: option.currentValue,
    options: option.options.flatMap((entry) =>
      "group" in entry
        ? entry.options.map(({ value, name }) => ({ value, name }))
        : [{ value: entry.value, name: entry.name }],
    ),
  } satisfies Agent.Models;
}

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Condense one ACP update into the events views display, ignoring the rest. */
function condense(update: Acp.SessionUpdate): Agent.Event | undefined {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return update.content.type === "text"
        ? {
            type: update.sessionUpdate === "agent_message_chunk" ? "text" : "thought",
            text: update.content.text,
          }
        : undefined;
    case "tool_call":
      return {
        type: "tool",
        id: update.toolCallId,
        title: update.title,
        status: update.status ?? "pending",
      };
    case "tool_call_update":
      return {
        type: "tool",
        id: update.toolCallId,
        title: update.title ?? "",
        status: update.status ?? "in_progress",
      };
    default:
      return undefined;
  }
}

/**
 * Describes a failed turn, naming the model when the provider refused its credentials.
 *
 * Agents report a provider's missing or rejected key as a generic internal
 * error, which does not say which model to fix.
 */
function explain(error: unknown, session: Session) {
  const text = message(error, "The agent failed.");
  const data =
    error instanceof Acp.RequestError && error.data !== undefined
      ? JSON.stringify(error.data)
      : "";
  if (!/auth|api key|bearer|unauthori[sz]ed|\b401\b/i.test(`${text} ${data}`))
    return text;
  const model = session.models.current ?? "the agent's default model";
  return `${text} (The provider for ${model} rejected its key or found none in the dev server's environment. Pick another model, or renew the key for this provider and restart \`bun dev\`.)`;
}

/**
 * Creates routes under `/api/agent` backed by a lazily started agent.
 *
 * The agent starts on the first session request and restarts on the next one
 * after it exits. Each browser dialog owns one ACP session on that process.
 */
export function createAgents(options: AgentOptions, context: Context) {
  const sessions = new Map<string, Session>();
  let starting: Promise<Process> | undefined;
  let current: Process | undefined;
  let closed = false;
  const children = new Set<NodeChildProcess.ChildProcess>();

  function stop(process: Process, message: string) {
    if (current !== process) return;
    current = undefined;
    starting = undefined;
    for (const session of sessions.values()) {
      for (const resolve of session.permissions.values()) resolve(cancelled);
      if (session.prompting) emit(session, { type: "error", message });
      session.prompting = false;
    }
    sessions.clear();
  }

  async function start(): Promise<Process> {
    const child = NodeChildProcess.spawn(options.command, [...(options.args ?? [])], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.add(child);
    child.once("close", () => children.delete(child));
    NodeReadline.createInterface({ input: child.stderr }).on("line", (line) => {
      if (line.trim()) context.log(line);
    });
    const app = Acp.client({ name: "moku" })
      .onNotification(Acp.methods.client.session.update, ({ params }) => {
        const session = sessions.get(params.sessionId);
        const event = condense(params.update);
        if (session && event) emit(session, event);
      })
      .onRequest(
        Acp.methods.client.session.requestPermission,
        ({ params, signal }) =>
          new Promise<Acp.RequestPermissionResponse>((resolve) => {
            const session = sessions.get(params.sessionId);
            // Nobody can answer a request that arrives while no view is listening.
            if (!session || session.listeners.size === 0)
              return resolve({ outcome: cancelled });
            const id = NodeCrypto.randomUUID();
            const settle = (outcome: Acp.RequestPermissionOutcome) => {
              if (!session.permissions.delete(id)) return;
              emit(session, { type: "permission-resolved", id });
              resolve({ outcome });
            };
            session.permissions.set(id, settle);
            signal.addEventListener("abort", () => settle(cancelled), { once: true });
            emit(session, {
              type: "permission",
              id,
              title: params.toolCall.title ?? "Use a tool",
              options: params.options.map((option) => ({
                id: option.optionId,
                name: option.name,
                kind: option.kind,
              })),
            });
          }),
      );
    const connection = app.connect(
      Acp.ndJsonStream(
        NodeStream.Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        NodeStream.Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      ),
    );
    const exited = new Promise<never>((_, reject) => {
      child.once("error", (error) => reject(new Error(error.message)));
      child.once("exit", (code, signal) =>
        reject(new Error(`The agent exited (${signal ?? code}).`)),
      );
    });
    try {
      const initialized = await Promise.race([
        connection.agent.request(Acp.methods.agent.initialize, {
          protocolVersion: Acp.PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: { name: "moku", version: "0.0.0" },
        }),
        exited,
      ]);
      if (closed) throw new Error("The local proxy is shutting down.");
      const started: Process = { child, connection, initialized };
      current = started;
      exited.catch((error: Error) => {
        context.log(error.message);
        stop(started, error.message);
      });
      return started;
    } catch (error) {
      kill(child);
      throw error;
    }
  }

  function kill(child: NodeChildProcess.ChildProcess) {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      // The agent may start its own servers, so signal its whole process group.
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }

  function agent() {
    if (closed) return Promise.reject(new Error("The local proxy is shutting down."));
    return (starting ??= start().catch((error: unknown) => {
      starting = undefined;
      throw error;
    }));
  }

  async function create(req: NodeHttp.IncomingMessage, res: NodeHttp.ServerResponse) {
    const raw = await readBody(req).catch(() => undefined);
    // An empty body fails to parse and selects the configured model.
    const body: Option.Option<typeof Agent.Create.Type> =
      raw === undefined
        ? Option.some({})
        : Schema.decodeUnknownOption(Agent.Create)(raw);
    if (Option.isNone(body))
      return json(res, 400, { error: "Send an optional model." });
    let process: Process;
    try {
      process = await agent();
    } catch (error) {
      context.log(error instanceof Error ? error.message : String(error));
      return json(res, 502, {
        code: "agent-unavailable",
        error: `Could not start the agent (${options.command}). Check that it is installed and signed in.`,
      });
    }
    const mcp = context.mcp();
    const notebookTools =
      mcp !== undefined &&
      process.initialized.agentCapabilities?.mcpCapabilities?.http === true;
    const created = await process.connection.agent.request(
      Acp.methods.agent.session.new,
      {
        cwd: options.cwd,
        mcpServers: notebookTools
          ? [{ type: "http", name: "marimo", url: mcp, headers: [] }]
          : [],
      },
    );
    const option = modelOption(created.configOptions);
    let available = models(created.configOptions);
    const wanted = body.value.model ?? options.model;
    if (wanted && option && wanted !== available.current)
      available = await process.connection.agent
        .request(Acp.methods.agent.session.setConfigOption, {
          sessionId: created.sessionId,
          configId: option.id,
          value: wanted,
        })
        .then((response) => models(response.configOptions))
        .catch((error: unknown) => {
          context.log(
            `Could not select model ${wanted}: ${message(error, String(error))}`,
          );
          return available;
        });
    sessions.set(created.sessionId, {
      turn: [],
      modelOption: option?.id,
      models: available,
      listeners: new Set(),
      permissions: new Map(),
      prompting: false,
    });
    return json(res, 201, {
      sessionId: created.sessionId,
      agent:
        process.initialized.agentInfo?.title ??
        process.initialized.agentInfo?.name ??
        null,
      notebookTools,
      models: available,
    } satisfies Agent.Created);
  }

  function events(
    req: NodeHttp.IncomingMessage,
    res: NodeHttp.ServerResponse,
    session: Session,
  ) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    // Send headers now so clients observe the open stream before the first event.
    res.flushHeaders();
    const send = (event: Agent.Event) =>
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    for (const event of session.turn) send(event);
    session.listeners.add(send);
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
    req.once("close", () => {
      clearInterval(heartbeat);
      session.listeners.delete(send);
      if (session.listeners.size === 0)
        for (const resolve of session.permissions.values()) resolve(cancelled);
    });
  }

  async function prompt(
    req: NodeHttp.IncomingMessage,
    res: NodeHttp.ServerResponse,
    sessionId: string,
    session: Session,
  ) {
    const body = Schema.decodeUnknownOption(Agent.Prompt)(
      await readBody(req, promptLimit).catch(() => undefined),
    );
    if (Option.isNone(body)) return json(res, 400, { error: "Send a text prompt." });
    if (session.prompting)
      return json(res, 409, {
        error: "The agent is still answering the last message.",
      });
    const process = current;
    if (!process) return json(res, 410, { error: "The agent session ended." });
    session.turn = [];
    session.prompting = true;
    process.connection.agent
      .request(Acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: body.value.text }],
      })
      .then(
        (response) => emit(session, { type: "stop", reason: response.stopReason }),
        (error: unknown) =>
          emit(session, { type: "error", message: explain(error, session) }),
      )
      .finally(() => {
        session.prompting = false;
      });
    return json(res, 202, { accepted: true });
  }

  async function select(
    req: NodeHttp.IncomingMessage,
    res: NodeHttp.ServerResponse,
    sessionId: string,
    session: Session,
  ) {
    const body = Schema.decodeUnknownOption(Agent.SelectModel)(
      await readBody(req).catch(() => undefined),
    );
    if (Option.isNone(body)) return json(res, 400, { error: "Choose a model." });
    if (session.modelOption === undefined)
      return json(res, 409, { error: "This agent does not offer a model choice." });
    if (session.prompting)
      return json(res, 409, {
        error: "The agent is still answering the last message.",
      });
    const process = current;
    if (!process) return json(res, 410, { error: "The agent session ended." });
    try {
      const response = await process.connection.agent.request(
        Acp.methods.agent.session.setConfigOption,
        { sessionId, configId: session.modelOption, value: body.value.value },
      );
      session.models = models(response.configOptions);
      return json(res, 200, session.models satisfies Agent.Models);
    } catch (error) {
      return json(res, 502, { error: message(error, "The agent rejected the model.") });
    }
  }

  async function answer(
    req: NodeHttp.IncomingMessage,
    res: NodeHttp.ServerResponse,
    session: Session,
    permissionId: string,
  ) {
    const body = Schema.decodeUnknownOption(Agent.Answer)(
      await readBody(req).catch(() => undefined),
    );
    const settle = session.permissions.get(permissionId);
    if (Option.isNone(body)) return json(res, 400, { error: "Choose an option." });
    if (!settle) return json(res, 404, { error: "This request was already answered." });
    settle(
      body.value.optionId === null
        ? cancelled
        : { outcome: "selected", optionId: body.value.optionId },
    );
    return json(res, 200, { answered: true });
  }

  async function cancel(
    res: NodeHttp.ServerResponse,
    sessionId: string,
    session: Session,
  ) {
    // ACP requires clients to withdraw pending permission requests when cancelling.
    for (const resolve of session.permissions.values()) resolve(cancelled);
    await current?.connection.agent.notify(Acp.methods.agent.session.cancel, {
      sessionId,
    });
    return json(res, 200, { cancelled: true });
  }

  return {
    /** Handles a request whose path starts with `/api/agent`. */
    async handle(
      req: NodeHttp.IncomingMessage,
      res: NodeHttp.ServerResponse,
      path: string,
    ) {
      if (path === "/sessions" && req.method === "POST") return create(req, res);
      const match = /^\/sessions\/([^/]+)(\/.*)$/.exec(path);
      const sessionId = match && decodeURIComponent(match[1]);
      const session = sessionId === null ? undefined : sessions.get(sessionId);
      if (!match || sessionId === null)
        return json(res, 404, { error: "This proxy does not expose that operation." });
      if (!session) return json(res, 410, { error: "The agent session ended." });
      const action = match[2];
      if (action === "/events" && req.method === "GET")
        return events(req, res, session);
      if (action === "/prompt" && req.method === "POST")
        return prompt(req, res, sessionId, session);
      if (action === "/model" && req.method === "POST")
        return select(req, res, sessionId, session);
      if (action === "/cancel" && req.method === "POST")
        return cancel(res, sessionId, session);
      const permission = /^\/permissions\/([^/]+)$/.exec(action);
      if (permission && req.method === "POST")
        return answer(req, res, session, decodeURIComponent(permission[1]));
      return json(res, 404, { error: "This proxy does not expose that operation." });
    },
    /** Stops the agent and withdraws pending requests. */
    close() {
      closed = true;
      const process = current;
      if (process) {
        stop(process, "The local proxy is shutting down.");
        process.connection.close();
      }
      for (const child of children) kill(child);
    },
  };
}
