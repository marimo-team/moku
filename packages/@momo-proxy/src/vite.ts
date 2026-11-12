/**
 * Vite integration for marimo discovery and an optional managed server.
 *
 * @module
 */
import type { Plugin, PreviewServer, ViteDevServer } from "vite-plus";
import { createApi } from "./server.ts";
import { startServer, type ServerOptions } from "./internal/managed.ts";
export type { ServerOptions } from "./internal/managed.ts";

export interface Options {
  readonly clientName?: string;
  /** Starts one marimo server alongside discovery of existing hosts. */
  readonly server?: ServerOptions;
}

/**
 * Adds the local proxy to Vite development and preview servers.
 *
 * `server` launches a command without a shell. Its arguments must invoke
 * `marimo edit`; the plugin supplies a loopback port, headless mode, and a
 * generated native token through stdin. Host protocol credentials still come
 * from discovery. Both credentials stay on the Vite server.
 *
 * Startup waits up to 60 seconds for the managed host. Closing Vite terminates
 * that process and its children. Existing discovered hosts are left running.
 *
 * @example Start marimo through uv
 * ```ts
 * marimo({
 *   server: {
 *     command: "uv",
 *     args: ["run", "--project", "../marimo", "marimo", "edit", "examples"],
 *   },
 * });
 * ```
 */
export function marimo({ clientName = "momo", server: command }: Options = {}): Plugin {
  const instances = new Set<() => Promise<void>>();
  async function configure(server: ViteDevServer | PreviewServer) {
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
      api = createApi({ origin, clientName, server: managed });
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
    name: "momo-proxy",
    async closeBundle() {
      await Promise.all([...instances].map((close) => close()));
    },
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
