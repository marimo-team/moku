import * as Vitest from "vite-plus/test";
import { vi } from "vite-plus/test";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import * as NodeUrl from "node:url";
import * as NodeHttp from "node:http";
import * as NodeChildProcess from "node:child_process";
import { createApi } from "../src/server.ts";
import { startServer } from "../src/internal/managed.ts";

const root = NodeUrl.fileURLToPath(new URL(".", import.meta.url));
const fixture = NodeUrl.fileURLToPath(
  new URL("./fixtures/process.mjs", import.meta.url),
);

Vitest.test(
  "a wrapper's child starts without native authentication and exits on release",
  async ({ onTestFinished }) => {
    const state = await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "moku-server-"));
    const controller = new AbortController();
    const logs: string[] = [];
    onTestFinished(async () => {
      controller.abort();
      await NodeFs.rm(state, { recursive: true, force: true });
    });
    const server = await startServer(
      {
        command: process.execPath,
        args: [fixture, "--wrapper"],
        env: { XDG_STATE_HOME: state },
      },
      { root, signal: controller.signal, log: (line) => logs.push(line) },
    );
    onTestFinished(server.close);
    const host = server.host!;
    Vitest.expect(host.token).toBe("host-protocol-token");
    const url = host.url.replace("/api/marimo/v1", "/");
    Vitest.expect((await fetch(url)).status).toBe(200);
    Vitest.expect((await fetch(host.url + "/events")).status).toBe(401);
    let origin = "";
    const api = createApi({
      origin: () => origin,
      server,
      discover: async function* () {
        yield host;
        yield {
          ...host,
          name: "existing",
          url: "http://127.0.0.1:1234/api/marimo/v1",
          token: "existing-host-token",
        };
      },
    });
    const proxy = NodeHttp.createServer(api.handle);
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => {
      api.close();
      proxy.closeAllConnections();
      proxy.close();
    });
    const address = proxy.address();
    if (!address || typeof address === "string")
      throw new Error("Missing proxy address");
    origin = `http://127.0.0.1:${address.port}`;
    const session = await fetch(origin + "/api/session", {
      method: "POST",
      headers: { Origin: origin, Authorization: `Bearer ${api.launchKey}` },
    });
    const headers = {
      Origin: origin,
      Cookie: session.headers.get("set-cookie")!.split(";")[0],
      "Content-Type": "application/json",
    };
    const raw = await (await fetch(origin + "/api/hosts", { headers })).text();
    const hosts: { id: string; url: string }[] = JSON.parse(raw);
    Vitest.expect(hosts).toHaveLength(2);
    for (const token of [host.token, "existing-host-token"])
      Vitest.expect(raw).not.toContain(token);
    const base = `${origin}/api/hosts/${hosts.find((entry) => entry.url === host.url)!.id}`;
    const native = await fetch(base + "/marimo/auth", {
      method: "POST",
      headers,
      body: "{}",
    });
    Vitest.expect(native.status).toBe(200);
    Vitest.expect(await native.json()).toEqual({ success: true });
    const events = await fetch(base + "/events", { headers });
    Vitest.expect(events.status).toBe(200);
    Vitest.expect(await events.text()).toContain("event: ready");
    Vitest.expect(logs[0]).toBe(`Starting marimo via ${process.execPath}…`);
    Vitest.expect(
      logs.some((line) => line.startsWith("Ready at http://127.0.0.1:")),
    ).toBe(true);
    Vitest.expect(logs.join("\n")).toContain("Native authentication disabled");
    Vitest.expect(logs.join("\n")).not.toContain(host.token);
    await server.close();
    Vitest.expect(server.host).toBeUndefined();
    await vi.waitFor(() =>
      Vitest.expect(() => process.kill(host.process.pid, 0)).toThrow(),
    );
    await server.close();
  },
);

Vitest.test("missing commands and early exits fail startup promptly", async () => {
  const context = { root, signal: new AbortController().signal, log: () => {} };
  await Vitest.expect(
    startServer({ command: "/no/such/marimo" }, context),
  ).rejects.toThrow("ENOENT");
  await Vitest.expect(
    startServer(
      { command: process.execPath, args: ["-e", "process.exit(7)", "--"] },
      context,
    ),
  ).rejects.toThrow("exited (7)");
});

Vitest.test(
  "aborting startup terminates the process before discovery is ready",
  async () => {
    const controller = new AbortController();
    let pid = 0;
    const starting = startServer(
      {
        command: process.execPath,
        args: ["-e", "console.log(process.pid); setInterval(() => {}, 1000)", "--"],
      },
      {
        root,
        signal: controller.signal,
        log: (line) => {
          if (/^\d+$/.test(line)) {
            pid = Number(line);
            controller.abort();
          }
        },
      },
    );
    await Vitest.expect(starting).rejects.toBeDefined();
    Vitest.expect(pid).toBeGreaterThan(0);
    Vitest.expect(() => process.kill(pid, 0)).toThrow();
  },
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  Vitest.test(
    `${signal} terminates detached managed children when the parent exits`,
    async ({ onTestFinished }) => {
      const state = await NodeFs.mkdtemp(
        NodePath.join(NodeOs.tmpdir(), "moku-signal-"),
      );
      const module = new URL("../src/internal/managed.ts", import.meta.url).href;
      const script = `
      import { startServer } from ${JSON.stringify(module)};
      const server = await startServer({ command: process.execPath, args: [${JSON.stringify(fixture)}, "--wrapper"], env: { XDG_STATE_HOME: ${JSON.stringify(state)} } }, { root: ${JSON.stringify(root)}, signal: new AbortController().signal, log: () => {} });
      console.log(server.host.process.pid);
    `;
      const parent = NodeChildProcess.spawn(
        process.execPath,
        ["--input-type=module", "-e", script],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const closed = new Promise<void>((resolve) =>
        parent.once("close", () => resolve()),
      );
      onTestFinished(async () => {
        parent.kill("SIGTERM");
        await closed;
        await NodeFs.rm(state, { recursive: true, force: true });
      });
      let pid = 0;
      let errors = "";
      parent.stderr.on("data", (chunk) => {
        errors += String(chunk);
      });
      parent.stdout.on("data", (chunk) => {
        pid = Number(String(chunk).trim());
      });
      await vi.waitFor(() => {
        if (parent.exitCode !== null) throw new Error(errors);
        Vitest.expect(pid).toBeGreaterThan(0);
      });
      parent.kill(signal);
      await closed;
      await vi.waitFor(() => Vitest.expect(() => process.kill(pid, 0)).toThrow());
    },
  );
}
