import * as Vitest from "vite-plus/test";
import { Effect } from "effect";
import { AtomRegistry } from "effect/reactivity";
import * as Core from "@moku/core";
import * as Workspace from "@moku/core/Workspace";

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
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const workspace = yield* Workspace.make();
        yield* workspace.authorizeInteractions({
          connectionId: "local",
          token: "native-token",
        });
      }),
    ).pipe(
      Effect.provide(Core.layer("http://moku.test", { fetch })),
      Effect.provide(AtomRegistry.layer),
    ),
  );
  const request = requests.find((request) => request.url.endsWith("/marimo/auth"));
  Vitest.expect(request?.method).toBe("POST");
  Vitest.expect(await request?.json()).toEqual({ token: "native-token" });
});
