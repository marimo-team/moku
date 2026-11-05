import { defineConfig, lazyPlugins } from "vite-plus";
import react from "@vitejs/plugin-react";
import { dagServer } from "./server/plugin.ts";

export default defineConfig({
  lint: { options: { typeAware: true, typeCheck: true } },
  plugins: lazyPlugins(() => [react(), dagServer()]),
  server: { host: "127.0.0.1", port: 5178, strictPort: true },
  preview: { host: "127.0.0.1", port: 5178, strictPort: true },
});
