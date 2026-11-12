# @momo/proxy

A local marimo host proxy with discovery, authentication, and Vite integration.

```ts
import { marimo } from "@momo/proxy/vite";
import { createApi } from "@momo/proxy";

marimo(); // Vite plugin for dev and preview

const proxy = createApi({ origin });
proxy.launchKey; // exchange for a local HttpOnly session cookie
proxy.handle; // standalone Node HTTP request handler
proxy.close(); // abort active upstream requests and discard manual connections
```
