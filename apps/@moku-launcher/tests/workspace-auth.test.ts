import * as Vitest from "vite-plus/test";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import * as Proxy from "../src/app/Proxy.ts";
import * as Workspace from "../src/app/Workspace.ts";

Vitest.test("native authorization accepts the proxy acknowledgement", async () => {
  const requests: Request[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    switch (new URL(request.url).pathname) {
      case "/api/session":
        return Response.json({ authenticated: true });
      case "/api/hosts":
        return Response.json([]);
      case "/api/hosts/local/marimo/auth":
        return Response.json({ success: true });
      default:
        throw new Error(`Unexpected request: ${request.url}`);
    }
  };
  const proxy = Proxy.make("http://moku.test", { fetch });
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* Workspace.make();
        yield* workspace.authorizeInteractions({
          connectionId: "local",
          token: "native-token",
        });
      }),
    ).pipe(Effect.provide(proxy.http), Effect.provide(AtomRegistry.layer)),
  );
  const request = requests.find((request) => request.url.endsWith("/marimo/auth"));
  Vitest.expect(request?.method).toBe("POST");
  Vitest.expect(await request?.json()).toEqual({ token: "native-token" });
});
