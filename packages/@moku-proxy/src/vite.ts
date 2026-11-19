/**
 * Vite integration for marimo discovery and an optional managed server.
 *
 * @module
 */
import type * as Vite from "vite-plus";
import { createApi } from "./server.ts";
import * as NodePath from "node:path";
import { startServer, type ServerOptions } from "./internal/managed.ts";
import type { AgentOptions as Agent } from "./internal/agent.ts";
export type { ServerOptions } from "./internal/managed.ts";

/** A command that starts a coding agent speaking ACP over standard input and output. */
export interface AgentOptions extends Omit<Agent, "cwd"> {
  /** The agent's working directory, relative to Vite's root. Defaults to the root itself. */
  readonly cwd?: string;
}

export interface Options {
  readonly clientName?: string;
  /** Starts one marimo server alongside discovery of existing hosts. */
  readonly server?: ServerOptions;
  /**
   * Serves dialogs from a coding agent, such as `opencode acp`.
   *
   * The agent starts with the first dialog. When the managed server runs with
   * `--mcp=code-mode`, each session receives its MCP endpoint so the agent can
   * read, edit, and run cells.
   */
  readonly agent?: AgentOptions;
}

/**
 * Adds the local proxy to Vite development and preview servers.
 *
 * `server` launches a command without a shell. Its arguments must invoke
 * `marimo edit`; the plugin supplies a loopback port and headless mode, and
 * disables native token authentication. Host protocol credentials still come
 * from discovery and stay on the Vite server.
 *
 * Startup waits up to 60 seconds for the managed host. Closing Vite terminates
 * that process and its children. Existing discovered hosts are left running.
 *
 * @example Start marimo through uv
 * ```ts
 * marimo({
 *   server: {
 *     command: "uv",
 *     args: ["run", "--project", "../marimo", "marimo", "edit", "notebooks"],
 *   },
 * });
 * ```
 */
export function marimo({
  clientName = "moku",
  server: command,
  agent,
}: Options = {}): Vite.Plugin {
  const instances = new Set<() => Promise<void>>();
  async function configure(server: Vite.ViteDevServer | Vite.PreviewServer) {
    const controller = new AbortController();
    let api: ReturnType<typeof createApi> | undefined;
    let managed: Awaited<ReturnType<typeof startServer>> | undefined;
    let starting: ReturnType<typeof startServer> | undefined;
    let closing: Promise<void> | undefined;
    const close = () =>
      (closing ??= (async () => {
        controller.abort();
        api?.close();
        await starting?.catch(() => undefined);
        await managed?.close();
        instances.delete(close);
      })());
    instances.add(close);
    server.httpServer?.once("close", () => {
      void close();
    });
    const origin = () => {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string")
        throw new Error("Server is not listening");
      return `http://127.0.0.1:${address.port}`;
    };
    try {
      if (command)
        managed = await (starting = startServer(command, {
          root: server.config.root,
          signal: controller.signal,
          log: (line) => server.config.logger.info(`[marimo] ${line}`),
        }));
      controller.signal.throwIfAborted();
      api = createApi({
        origin,
        clientName,
        server: managed,
        agent: agent && {
          ...agent,
          cwd: NodePath.resolve(server.config.root, agent.cwd ?? "."),
        },
        log: (line) => server.config.logger.info(`[agent] ${line}`),
      });
      const proxy = api;
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/api/")) proxy.handle(req, res);
        else next();
      });
      server.httpServer?.once("listening", () => {
        setTimeout(() => {
          if (!controller.signal.aborted)
            server.config.logger.info(
              `\n  Open ${clientName} → ${origin()}/#key=${proxy.launchKey}\n`,
            );
        }, 0);
      });
    } catch (cause) {
      await close();
      throw cause;
    }
  }
  return {
    name: "moku-proxy",
    async closeBundle() {
      await Promise.all([...instances].map((close) => close()));
    },
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
