# @moku/proxy

A local gateway that connects browser clients to marimo hosts and keeps host credentials on the server.

```ts
import { defineConfig } from "vite-plus";
import { marimo, type Options } from "@moku/proxy/vite";

const options: Options = {
  clientName: "moku",
  server: {
    command: "uv",
    args: ["run", "--project", "../marimo", "marimo", "edit", "notebooks"],
  },
};

export default defineConfig({ plugins: [marimo(options)] });
```

Open the authenticated link printed in the terminal. Omit `server` to discover
existing hosts without starting one.

For a Node HTTP server, `createApi` exposes the same proxy:

```ts
import { createServer } from "node:http";
import { createApi } from "@moku/proxy";

const api = createApi({ origin: () => "http://127.0.0.1:3000" });
const server = createServer(api.handle);
server.on("close", () => api.close());
server.listen(3000, "127.0.0.1");
```

Use `api.launchKey` to establish a browser session through `POST /api/session`.
