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

Pass `agent` to answer dialogs from a coding agent that speaks the Agent Client
Protocol over standard input and output. The proxy starts the agent with the
first dialog and serves its sessions under `/api/agent`, condensing protocol
updates into the events described in [Agent.ts](src/Agent.ts). When the managed
server runs with `--mcp=code-mode`, each session also receives marimo's MCP
endpoint, which lets the agent read, edit, and run cells in the live notebook.

```ts
marimo({
  server: {
    command: "uv",
    args: ["run", "marimo", "edit", "notebooks", "--mcp=code-mode"],
  },
  agent: { command: "opencode", args: ["acp"] },
});
```
