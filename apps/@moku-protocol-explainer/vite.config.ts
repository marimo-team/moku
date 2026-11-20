import * as Vite from "vite-plus";
import * as NodeUrl from "node:url";
import react from "@vitejs/plugin-react";

export default Vite.defineConfig({
  cacheDir: NodeUrl.fileURLToPath(new URL("./node_modules/.vite", import.meta.url)),
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5180, strictPort: true },
  preview: { host: "127.0.0.1", port: 5180, strictPort: true },
});
