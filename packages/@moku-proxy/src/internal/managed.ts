/**
 * Own one marimo process and wait for its authenticated discovery record.
 *
 * @module
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeTimers from "node:timers/promises";
import * as NodeUtil from "node:util";
import * as MarimoNode from "@marimo-team/client/node";
import type { HostRecordOutput } from "@marimo-team/client/protocol";

/** A command that launches `marimo edit`, optionally through uv or another wrapper. */
export interface ServerOptions {
  readonly command: string;
  readonly args?: readonly string[];
  /** Working directory, relative to Vite's root. Defaults to the root itself. */
  readonly cwd?: string;
  /** Overrides inherited environment variables. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface ManagedServer {
  /** Undefined after the managed process exits. */
  readonly host: HostRecordOutput | undefined;
  readonly close: () => Promise<void>;
}

const exec = NodeUtil.promisify(NodeChildProcess.execFile);
const managedFlags = new Set([
  "--port",
  "-p",
  "--host",
  "--token",
  "--no-token",
  "--token-password",
  "--token-password-file",
]);

async function availablePort(): Promise<number> {
  const socket = NodeNet.createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const address = socket.address();
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  if (!address || typeof address === "string")
    throw new Error("Could not allocate a marimo port.");
  return address.port;
}

export async function startServer(
  options: ServerOptions,
  context: { root: string; signal: AbortSignal; log: (message: string) => void },
): Promise<ManagedServer> {
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw new Error("Managed marimo servers require macOS or Linux.");
  const args = [...(options.args ?? [])];
  for (const arg of args)
    if (managedFlags.has(arg.split("=")[0]) || /^-p\d/.test(arg))
      throw new Error(
        `The marimo plugin manages ${arg.split("=")[0]} and native authentication.`,
      );
  const port = await availablePort();
  context.signal.throwIfAborted();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    MARIMO_ANCESTOR_PID: String(process.pid),
  };
  context.log(`Starting marimo via ${options.command}…`);
  const startedAt = Date.now();
  const child = NodeChildProcess.spawn(
    options.command,
    [
      ...args,
      "--headless",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--no-token",
    ],
    {
      cwd: NodePath.resolve(context.root, options.cwd ?? "."),
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [child.stdout, child.stderr])
    NodeReadline.createInterface({ input: stream }).on("line", (line) => {
      if (line.trim()) context.log(line);
    });
  let host: HostRecordOutput | undefined;
  let failure: Error | undefined;
  let stopped = false;
  const ended = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      failure = new Error(error.message);
    });
    child.once("exit", (code, signal) => {
      host = undefined;
      stopped = true;
      failure ??= new Error(`Managed marimo exited (${signal ?? code}).`);
      if (!closing) context.log(failure.message);
    });
    child.once("close", () => {
      stopped = true;
      resolve();
    });
  });

  const groups = new Set(child.pid ? [child.pid] : []);
  async function descendants() {
    const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,pgid="]);
    const rows = stdout
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number));
    const parents = new Map(rows.map(([pid, parent]) => [pid, parent]));
    const owned = new Set<number>();
    for (const [pid] of rows) {
      let ancestor: number | undefined = pid;
      const seen = new Set<number>();
      while (ancestor && !seen.has(ancestor)) {
        if (ancestor === child.pid) {
          owned.add(pid);
          break;
        }
        seen.add(ancestor);
        ancestor = parents.get(ancestor);
      }
    }
    for (const [pid, , group] of rows)
      if (owned.has(pid) && owned.has(group)) groups.add(group);
    return owned;
  }
  function kill(signal: NodeJS.Signals) {
    for (const group of groups) {
      try {
        process.kill(-group, signal);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
      }
    }
  }
  const emergency = () => kill("SIGKILL");
  const interrupt = () => terminate("SIGINT");
  const terminateSignal = () => terminate("SIGTERM");
  function terminate(signal: "SIGINT" | "SIGTERM") {
    emergency();
    // Preserve the default signal behavior when Vite has no handler of its own.
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  }
  process.once("exit", emergency);
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminateSignal);
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    return (closing ??= (async () => {
      host = undefined;
      await descendants().catch(() => undefined);
      kill("SIGTERM");
      const timeout = setTimeout(() => kill("SIGKILL"), 5_000);
      try {
        await ended;
        kill("SIGKILL");
      } finally {
        clearTimeout(timeout);
        context.signal.removeEventListener("abort", abort);
        process.removeListener("exit", emergency);
        process.removeListener("SIGINT", interrupt);
        process.removeListener("SIGTERM", terminateSignal);
      }
    })());
  }
  const abort = () => {
    void close();
  };
  context.signal.addEventListener("abort", abort, { once: true });
  if (context.signal.aborted) abort();
  const signal = AbortSignal.any([context.signal, AbortSignal.timeout(60_000)]);
  const stateDir = env.XDG_STATE_HOME?.trim()
    ? NodePath.join(env.XDG_STATE_HOME, "marimo")
    : undefined;
  const waiting = setInterval(() => {
    context.log(
      `Waiting for marimo to become ready (${Math.round((Date.now() - startedAt) / 1000)}s)…`,
    );
  }, 10_000);
  try {
    while (!signal.aborted) {
      if (failure) throw failure;
      for await (const record of MarimoNode.discoverHosts({ stateDir })) {
        const url = new URL(record.url);
        if (url.port !== String(port)) continue;
        // uv and marimo's sandbox may introduce both children and new groups.
        if (!(await descendants()).has(record.process.pid)) continue;
        const response = await fetch(`${record.url}/events?types=host`, {
          headers: { Authorization: `Bearer ${record.token}` },
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
        }).catch(() => undefined);
        if (!response) continue;
        await response.body?.cancel();
        if (!response.ok)
          throw new Error(
            "Managed marimo rejected its discovered host protocol credentials.",
          );
        if (stopped || signal.aborted) break;
        host = record;
        context.log(
          `Ready at http://127.0.0.1:${port} (${((Date.now() - startedAt) / 1000).toFixed(1)}s).`,
        );
        return {
          get host() {
            return host;
          },
          close,
        };
      }
      await NodeTimers.setTimeout(100, undefined, { signal });
    }
    signal.throwIfAborted();
    throw new Error("Managed marimo did not publish a host record.");
  } catch (cause) {
    await close();
    if (signal.aborted && !context.signal.aborted)
      throw new Error("Managed marimo did not become ready within 60 seconds.");
    throw cause;
  } finally {
    clearInterval(waiting);
  }
}
