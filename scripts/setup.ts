/** Prepare marimo dependencies from one pinned GitHub revision. @module */
import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import { checkout, local, repository, revision as pin, root } from "./marimo.ts";

if (!/^[a-f0-9]{40}$/.test(pin)) {
  throw new Error("Set marimo.json revision to a full GitHub commit SHA.");
}
const env = { ...process.env };
// This subprocess selects a different workspace's package-manager pin.
delete env.VP_TOOL_RECURSION;
function run(command: string, args: string[], cwd = checkout): void {
  NodeChildProcess.execFileSync(command, args, { cwd, stdio: "inherit", env });
}
function git(...args: string[]): string {
  return NodeChildProcess.execFileSync("git", args, {
    cwd: checkout,
    encoding: "utf8",
    env,
  }).trim();
}
if (!local) {
  await NodeFs.mkdir(checkout, { recursive: true });
  try {
    await NodeFs.access(NodePath.join(checkout, ".git"));
  } catch {
    run("git", ["init", "--quiet"]);
    run("git", ["remote", "add", "origin", repository]);
  }
  if (git("remote", "get-url", "origin") !== repository) {
    throw new Error(
      `Unexpected repository at ${checkout}. Remove that cache directory and retry.`,
    );
  }
  let current = "";
  try {
    current = git("rev-parse", "--verify", "HEAD");
  } catch {
    // A newly initialized checkout has no HEAD yet.
  }
  if (current !== pin) {
    run("git", ["fetch", "--depth=1", "origin", pin]);
    run("git", ["checkout", "--detach", "FETCH_HEAD"]);
  }
  if (
    git("rev-parse", "HEAD") !== pin ||
    git("status", "--porcelain", "--untracked-files=no")
  ) {
    throw new Error(`Expected an unmodified checkout of ${pin} at ${checkout}.`);
  }
}
const revision = git("rev-parse", "HEAD");
console.log(`Preparing marimo from ${local ? checkout : `${repository}@${revision}`}`);

// Use upstream's package manager and lockfile for its own workspace.
const upstream = JSON.parse(
  await NodeFs.readFile(NodePath.join(checkout, "package.json"), "utf8"),
) as {
  packageManager: string;
};
if (!/^pnpm@\d+\.\d+\.\d+$/.test(upstream.packageManager)) {
  throw new Error(`Unsupported upstream package manager: ${upstream.packageManager}`);
}
const pnpmVersion = NodeChildProcess.execFileSync("pnpm", ["--version"], {
  cwd: checkout,
  encoding: "utf8",
  env,
}).trim();
if (`pnpm@${pnpmVersion}` !== upstream.packageManager) {
  throw new Error(
    `Install ${upstream.packageManager} to prepare this marimo revision (found pnpm@${pnpmVersion}).`,
  );
}
run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]);
run("bun", ["run", "build"], NodePath.join(checkout, "packages/client"));

for (const [name, content] of [
  ["client", "dist"],
  ["smart-cells", "src"],
] as const) {
  const source = NodePath.join(checkout, "packages", name);
  const destination = NodePath.join(root, "vendor", name);
  const manifest = JSON.parse(
    await NodeFs.readFile(NodePath.join(source, "package.json"), "utf8"),
  );
  delete manifest.scripts;
  delete manifest.devDependencies;
  manifest.version = `${manifest.version}-moku.${revision}`;
  await NodeFs.mkdir(destination, { recursive: true });
  await NodeFs.rm(NodePath.join(destination, content), {
    recursive: true,
    force: true,
  });
  await NodeFs.cp(NodePath.join(source, content), NodePath.join(destination, content), {
    recursive: true,
  });
  await NodeFs.writeFile(
    NodePath.join(destination, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  for (const file of ["README.md", "LICENSE"]) {
    const path = NodePath.join(source, file);
    await NodeFs.copyFile(
      await NodeFs.access(path).then(
        () => path,
        () => NodePath.join(checkout, file),
      ),
      NodePath.join(destination, file),
    );
  }
}
run("bun", ["install", ...(local ? ["--force"] : [])], root);
run("bun", ["run", "--filter", "@moku/outputs", "build"], root);
console.log(`Prepared marimo ${revision}`);
