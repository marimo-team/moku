import * as Vite from "vite-plus";
import react from "@vitejs/plugin-react";
import { marimo } from "@moku/proxy/vite";
import { server } from "../../scripts/marimo.ts";
import { agent } from "../../scripts/agent.ts";

export default Vite.defineConfig({
  plugins: Vite.lazyPlugins(() => [react(), marimo({ server, agent })]),
  server: { host: "127.0.0.1", port: 5178, strictPort: true },
  preview: { host: "127.0.0.1", port: 5178, strictPort: true },
});
