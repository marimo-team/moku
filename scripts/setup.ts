/** Prepare marimo dependencies from one pinned GitHub revision. @module */
import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import * as Marimo from "./marimo.ts";

if (!/^[a-f0-9]{40}$/.test(Marimo.revision)) {
  throw new Error("Set package.json marimo.revision to a full GitHub commit SHA.");
}
const env = { ...process.env };
// This subprocess selects a different workspace's package-manager pin.
delete env.VP_TOOL_RECURSION;
function run(command: string, args: string[], cwd = Marimo.checkout): void {
  NodeChildProcess.execFileSync(command, args, { cwd, stdio: "inherit", env });
}
function git(...args: string[]): string {
  return NodeChildProcess.execFileSync("git", args, {
    cwd: Marimo.checkout,
    encoding: "utf8",
    env,
  }).trim();
}
if (!Marimo.local) {
  await NodeFs.mkdir(Marimo.checkout, { recursive: true });
  try {
    await NodeFs.access(NodePath.join(Marimo.checkout, ".git"));
  } catch {
    run("git", ["init", "--quiet"]);
    run("git", ["remote", "add", "origin", Marimo.repository]);
  }
  if (git("remote", "get-url", "origin") !== Marimo.repository) {
    throw new Error(
      `Unexpected repository at ${Marimo.checkout}. Remove that cache directory and retry.`,
    );
  }
  let current = "";
  try {
    current = git("rev-parse", "--verify", "HEAD");
  } catch {
    // A newly initialized checkout has no HEAD yet.
  }
  if (current !== Marimo.revision) {
    run("git", ["fetch", "--depth=1", "origin", Marimo.revision]);
    run("git", ["checkout", "--detach", "FETCH_HEAD"]);
  }
  if (
    git("rev-parse", "HEAD") !== Marimo.revision ||
    git("status", "--porcelain", "--untracked-files=no")
  ) {
    throw new Error(
      `Expected an unmodified checkout of ${Marimo.revision} at ${Marimo.checkout}.`,
    );
  }
}
const revision = git("rev-parse", "HEAD");
console.log(
  `Preparing marimo from ${Marimo.local ? Marimo.checkout : `${Marimo.repository}@${revision}`}`,
);

// Use upstream's package manager and lockfile for its own workspace.
const upstream = JSON.parse(
  await NodeFs.readFile(NodePath.join(Marimo.checkout, "package.json"), "utf8"),
) as {
  packageManager: string;
};
if (!/^pnpm@\d+\.\d+\.\d+$/.test(upstream.packageManager)) {
  throw new Error(`Unsupported upstream package manager: ${upstream.packageManager}`);
}
const pnpmVersion = NodeChildProcess.execFileSync("pnpm", ["--version"], {
  cwd: Marimo.checkout,
  encoding: "utf8",
  env,
}).trim();
if (`pnpm@${pnpmVersion}` !== upstream.packageManager) {
  throw new Error(
    `Install ${upstream.packageManager} to prepare this marimo revision (found pnpm@${pnpmVersion}).`,
  );
}
run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]);
run("bun", ["run", "build"], NodePath.join(Marimo.checkout, "packages/client"));
run("bun", ["run", "codegen"], NodePath.join(Marimo.checkout, "packages/llm-info"));
run(
  "bun",
  ["run", "build", "--outDir", "../marimo/_static"],
  NodePath.join(Marimo.checkout, "frontend"),
);

for (const [name, content] of [
  ["client", "dist"],
  ["smart-cells", "src"],
] as const) {
  const source = NodePath.join(Marimo.checkout, "packages", name);
  const destination = NodePath.join(Marimo.root, "vendor", name);
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
        () => NodePath.join(Marimo.checkout, file),
      ),
      NodePath.join(destination, file),
    );
  }
}
run("bun", ["install", ...(Marimo.local ? ["--force"] : [])], Marimo.root);
run("bun", ["run", "--filter", "@moku/outputs", "build"], Marimo.root);
console.log(`Prepared marimo ${revision}`);
