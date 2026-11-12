/** Opt-in live stress test: bun packages/@moku-core/tests/stress-runtime.ts [rounds]. */
import * as NodeHttp from "node:http";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { Effect, Exit, Layer, Scope, Stream } from "effect";
import { AtomRegistry } from "effect/reactivity";
import * as Model from "../src/index.ts";
import * as Notebook from "../src/Notebook.ts";
import * as Runtime from "../src/Runtime.ts";
import * as Workspace from "../src/Workspace.ts";
import { startServer } from "../../@moku-proxy/src/internal/managed.ts";
import { createApi } from "../../@moku-proxy/src/server.ts";
import { server, root } from "../../../scripts/marimo.ts";

const rounds = Number(process.argv[2] ?? 3);
if (!Number.isInteger(rounds) || rounds < 1)
  throw new Error("Expected positive rounds");
const directory = await NodeFs.mkdtemp(
  NodePath.join(NodeOs.tmpdir(), "moku-runtime-stress-"),
);
const logs: string[] = [];
const results: unknown[] = [];
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
// Unique paths force new script environments without clearing the user's uv cache.
for (const name of ["controls", "pipeline"])
  for (let i = 0; i < 4; i++)
    await NodeFs.copyFile(
      NodePath.join(root, "notebooks", `${name}.py`),
      NodePath.join(directory, `${name}-${i}.py`),
    );
console.log(`Artifacts: ${directory}`);
const managed = await startServer(
  {
    ...server,
    args: server.args.map((arg) => (arg === "notebooks" ? directory : arg)),
  },
  {
    root,
    signal: new AbortController().signal,
    log: (line) => {
      logs.push(line);
    },
  },
);
let origin = "";
const api = createApi({
  origin: () => origin,
  server: managed,
  discover: async function* () {},
});
const proxy = NodeHttp.createServer(api.handle);
const registry = AtomRegistry.make();
const scope = Effect.runSync(Scope.make());
const subscriptions: Promise<unknown>[] = [];
try {
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("Missing proxy address");
  origin = `http://127.0.0.1:${address.port}`;
  const auth = await fetch(origin + "/api/session", {
    method: "POST",
    headers: { Origin: origin, Authorization: `Bearer ${api.launchKey}` },
  });
  const cookie = auth.headers.get("set-cookie")!.split(";")[0];
  const send: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("Origin", origin);
    headers.set("Cookie", cookie);
    return fetch(input, { ...init, headers });
  };
  const layer = Model.layer(origin, { fetch: send });
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      Layer.Success<typeof layer> | AtomRegistry.AtomRegistry | Scope.Scope
    >,
    timeout = true,
  ) =>
    Effect.runPromise(
      (timeout ? effect.pipe(Effect.timeout("90 seconds")) : effect).pipe(
        Effect.provide(layer),
        Effect.provideService(AtomRegistry.AtomRegistry, registry),
        Effect.provideService(Scope.Scope, scope),
      ),
      { signal: controller.signal },
    );
  async function wait(label: string, check: () => boolean, seconds = 30) {
    const deadline = Date.now() + seconds * 1000;
    while (!check()) {
      controller.signal.throwIfAborted();
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  const workspace = await run(Workspace.make());
  await run(workspace.refresh);
  const connection = registry.get(workspace.state).connections[0];
  if (!connection) throw new Error("No managed host");
  const catalog = workspace.catalog(connection.id);
  const unmount = registry.mount(catalog);
  await wait("catalog", () => registry.get(catalog).value.ready);
  const notebooks = await Promise.all(
    Object.values(registry.get(catalog).value.notebooks).map(async (record) => {
      const notebook = await run(
        Notebook.make({ connectionId: connection.id, notebookId: record.id }),
      );
      await wait("snapshot", () => registry.get(notebook.state).value.ready);
      subscriptions.push(
        run(Stream.runDrain(notebook.runtime.events), false).catch(() => {}),
      );
      return { notebook, record };
    }),
  );
  unmount();
  if (notebooks.length !== 8)
    throw new Error(`Expected 8 notebooks, got ${notebooks.length}`);
  for (let round = 0; round < rounds; round++) {
    // allSettled keeps sibling cycles owned until cleanup, including a failure.
    const completed = await Promise.allSettled(
      notebooks.map(async ({ notebook, record }) => {
        const started = Date.now();
        if (round > 0) {
          await run(notebook.runtime.stop({ requestId: crypto.randomUUID() }));
          await wait(
            "stopped",
            () => registry.get(notebook.state).value.runtime === null,
          );
        }
        if (!(await run(Runtime.ensureRunning(notebook))))
          throw new Error("Startup ended");
        const ready = Date.now();
        const cells = Object.values(registry.get(notebook.state).value.cells)
          .filter((cell) => !cell.config.disabled)
          .map(({ id, etag }) => ({ id, etag }));
        const submitted = await run(
          notebook.runtime.run({ requestId: crypto.randomUUID(), request: { cells } }),
        );
        await wait(
          `run ${record.name}`,
          () =>
            registry.get(notebook.state).value.runs[submitted.id]?.status ===
            "completed",
        );
        const outcome = registry.get(notebook.state).value.runs[submitted.id].outcome;
        if (outcome !== "succeeded")
          throw new Error(`Unexpected outcome ${JSON.stringify(outcome)}`);
        await wait(
          "native outputs",
          () => registry.get(notebook.runtime.state).connection !== "connecting",
        );
        const native = registry.get(notebook.runtime.state);
        if (native.connection !== "connected")
          throw new Error(`Output connection: ${JSON.stringify(native)}`);
        const result = {
          round,
          notebook: record.name,
          startupMs: ready - started,
          totalMs: Date.now() - started,
          outcome,
          native: native.connection,
        };
        results.push(result);
        console.log(JSON.stringify(result));
      }),
    );
    const failed = completed.filter((result) => result.status === "rejected");
    if (failed.length) {
      await NodeFs.writeFile(
        NodePath.join(directory, "failure-state.json"),
        JSON.stringify(
          notebooks.map(({ notebook, record }) => ({
            name: record.name,
            state: registry.get(notebook.state),
            outputs: registry.get(notebook.runtime.state),
          })),
          null,
          2,
        ),
      );
      throw new AggregateError(
        failed.map((result) => result.reason),
        "Live runtime stress failed",
      );
    }
  }
  console.log(
    `PASS: ${results.length} kernel starts, full runs, and native output connections`,
  );
} finally {
  await NodeFs.writeFile(NodePath.join(directory, "server.log"), logs.join("\n"));
  await NodeFs.writeFile(
    NodePath.join(directory, "results.json"),
    JSON.stringify(results, null, 2),
  );
  controller.abort();
  await Promise.allSettled(subscriptions);
  await Effect.runPromise(Scope.close(scope, Exit.void));
  registry.dispose();
  api.close();
  proxy.closeAllConnections();
  proxy.close();
  await managed.close();
}
