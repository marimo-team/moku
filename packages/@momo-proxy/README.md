# @momo/proxy

A local marimo host proxy with discovery, authentication, and Vite integration.

```ts
import { defineConfig, lazyPlugins } from "vite-plus";
import { marimo } from "@momo/proxy/vite";

export default defineConfig({
  plugins: lazyPlugins(() => [marimo()]),
});
```

The plugin discovers local hosts, prints an authenticated launch link, and serves
notebook requests in development and preview. Stored host credentials stay on the
server. `marimo({ clientName })` changes the terminal label.

For a standalone Node server, `createApi({ origin })` from `@momo/proxy` returns a
`handle` request handler and a `launchKey` for session authentication. Call `close()`
when the server shuts down to cancel upstream requests and release connections.
