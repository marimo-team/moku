# @momo/proxy

A local marimo host proxy with discovery, authentication, and Vite integration.

```ts
import { marimo } from "@momo/proxy/vite";
import { createApi } from "@momo/proxy";

marimo({ clientName: "dag" }); // Vite plugin for dev and preview

createApi({ origin, clientName }); // standalone Node HTTP handler and launch key

// Discovers local hosts and prints an authenticated launch link.
// Keeps stored host credentials server-side.
// Proxies approved requests and notebook event streams.
// clientName labels terminal output and attachments; it does not select an app.
// Manual host connections and explicit shutdown cleanup remain migration work.
```
