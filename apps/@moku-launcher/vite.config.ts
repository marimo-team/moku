import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import { marimo } from "@moku/proxy/vite";
import { server } from "../../scripts/marimo.ts";

export default defineConfig({
  plugins: lazyPlugins(() => [react(), marimo({ server })]),
  server: { host: "127.0.0.1", port: 5178, strictPort: true },
  preview: { host: "127.0.0.1", port: 5178, strictPort: true },
});
