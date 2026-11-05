import type { Plugin, PreviewServer, ViteDevServer } from "vite-plus";
import { createApi } from "./api.ts";

export function dagServer(): Plugin {
  function configure(server: ViteDevServer | PreviewServer) {
    const origin = () => {
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Server is not listening");
      return `http://127.0.0.1:${address.port}`;
    };
    const api = createApi({ origin });
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith("/api/")) api.handle(req, res);
      else next();
    });
    server.httpServer?.once("listening", () => {
      setTimeout(() => {
        server.config.logger.info(`\n  Open dag → ${origin()}/#key=${api.launchKey}\n`);
      }, 0);
    });
  }
  return {
    name: "marimo-dag",
    configureServer: configure,
    configurePreviewServer: configure,
  };
}
