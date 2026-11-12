import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

if (process.argv.includes("--wrapper")) {
  const args = process.argv.slice(1).filter((arg) => arg !== "--wrapper");
  const child = spawn(process.execPath, args, { stdio: "inherit", detached: true });
  process.on("SIGTERM", () => {});
  child.on("exit", (code) => process.exit(code ?? 0));
} else {
  if (!process.argv.includes("--no-token")) throw new Error("Expected --no-token");
  const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
  const root = join(process.env.XDG_STATE_HOME, "marimo", "hosts-v1");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "managed.json");
  const http = createServer((req, res) => {
    if (req.url.startsWith("/api/marimo/v1/events")) {
      if (req.headers.authorization !== "Bearer host-protocol-token")
        return res.writeHead(401).end();
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end("event: ready\ndata: {}\n\n");
      return;
    }
    res.end('<marimo-server-token data-token="csrf-token"></marimo-server-token>');
  });
  await new Promise((resolve) => http.listen(port, "127.0.0.1", resolve));
  const started = execFileSync(
    "/bin/ps",
    ["-o", "lstart=", "-p", String(process.pid)],
    { encoding: "utf8" },
  );
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      name: "fixture",
      url: `http://127.0.0.1:${port}/api/marimo/v1`,
      token: "host-protocol-token",
      process: { pid: process.pid, started_at: new Date(started.trim()).toISOString() },
    }),
    { mode: 0o600 },
  );
  console.log("Native authentication disabled");
  process.on("SIGTERM", () => {
    void rm(path, { force: true }).then(() => http.close(() => process.exit(0)));
  });
}
