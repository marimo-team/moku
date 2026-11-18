import * as Vite from "vite-plus";
import react from "@vitejs/plugin-react";
import { marimo } from "@moku/proxy/vite";
import { server } from "../../scripts/marimo.ts";
import { version as protocolVersion } from "../../vendor/host-protocol/package.json";
import { neo4jWidget } from "./src/plugins/neo4j/widget/vite.ts";

export default Vite.defineConfig({
  // Bun's file dependency keeps the same lockfile entry across marimo revisions.
  cacheDir: `node_modules/.vite/${protocolVersion}`,
  plugins: Vite.lazyPlugins(() => [react(), marimo({ server }), neo4jWidget()]),
  server: { host: "127.0.0.1", port: 5178, strictPort: true },
  preview: { host: "127.0.0.1", port: 5178, strictPort: true },
});
