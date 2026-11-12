import type { Plugin, PreviewServer, ViteDevServer } from "vite-plus";
import { createApi } from "./server.ts";

export function marimo({ clientName = "momo" }: { clientName?: string } = {}): Plugin {
  const proxies = new Set<ReturnType<typeof createApi>>();
  function configure(server: ViteDevServer | PreviewServer) {
    const origin = () => {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string")
        throw new Error("Server is not listening");
      return `http://127.0.0.1:${address.port}`;
    };
    const api = createApi({ origin, clientName });
    proxies.add(api);
    server.httpServer?.once("close", () => {
      api.close();
      proxies.delete(api);
    });
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith("/api/")) api.handle(req, res);
      else next();
    });
    server.httpServer?.once("listening", () => {
      setTimeout(() => {
        server.config.logger.info(
          `\n  Open ${clientName} → ${origin()}/#key=${api.launchKey}\n`,
        );
      }, 0);
    });
  }
  return {
    name: "momo-proxy",
    closeBundle() {
      for (const api of proxies) api.close();
      proxies.clear();
    },
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
