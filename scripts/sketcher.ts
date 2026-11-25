/**
 * Vendor the Sketcher board from a koaning/sketcher checkout into `vendor/sketcher`.
 *
 * Run `bun run sketcher ../sketcher` after the board changes upstream. The script
 * replaces the vendored sources with the checkout's `web/src` and the Claude helpers the
 * Drawing view's dev-server routes share with Sketcher's own dev server, then records the
 * commit it copied in the vendored README and in a header on every file.
 *
 * @module
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUrl from "node:url";

const root = NodeUrl.fileURLToPath(new URL("../", import.meta.url));
const destination = NodePath.join(root, "vendor/sketcher");
const [checkoutArgument] = process.argv.slice(2);
if (!checkoutArgument) {
  console.error("Usage: bun run sketcher <sketcher checkout>");
  process.exit(2);
}
const checkout = NodePath.resolve(checkoutArgument);

function git(...args: string[]): string {
  return NodeChildProcess.execFileSync("git", args, {
    cwd: checkout,
    encoding: "utf8",
  }).trim();
}
const revision = git("rev-parse", "HEAD");
const dirty = git(
  "status",
  "--porcelain",
  "--untracked-files=no",
  "--",
  "web",
  "python",
);
if (dirty) {
  throw new Error(
    `Commit or discard the board changes in ${checkout} before vendoring.`,
  );
}

const upstream = JSON.parse(
  await NodeFs.readFile(NodePath.join(checkout, "web/package.json"), "utf8"),
) as { dependencies: Record<string, string> };

// The anywidget entry and the standalone demo page belong to Sketcher's own hosts.
const excluded = new Set(["web/src/widget.ts", "web/src/dev"]);
const copies: { from: string; to: string; rewrite?: (text: string) => string }[] = [
  {
    from: "web/vite/claudeBridge.ts",
    to: "vite/claudeBridge.ts",
    rewrite: (text) =>
      text.replace("../../python/src/sketcher/claude.json", "./claude.json"),
  },
  { from: "python/src/sketcher/claude.json", to: "vite/claude.json" },
];
for (const entry of await NodeFs.readdir(NodePath.join(checkout, "web/src"), {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile()) continue;
  const from = NodePath.relative(checkout, NodePath.join(entry.parentPath, entry.name));
  if ([...excluded].some((path) => from === path || from.startsWith(`${path}/`)))
    continue;
  copies.push({ from, to: NodePath.relative("web", from) });
}

function header(from: string, to: string): string {
  const text = `Vendored from koaning/sketcher@${revision} ${from}. Edit it there and rerun scripts/sketcher.ts.`;
  if (/\.(ts|tsx)$/.test(to)) return `// ${text}\n`;
  if (to.endsWith(".css")) return `/* ${text} */\n`;
  return "";
}

for (const directory of ["src", "vite"]) {
  await NodeFs.rm(NodePath.join(destination, directory), {
    recursive: true,
    force: true,
  });
}
for (const { from, to, rewrite } of copies) {
  const text = await NodeFs.readFile(NodePath.join(checkout, from), "utf8");
  const target = NodePath.join(destination, to);
  await NodeFs.mkdir(NodePath.dirname(target), { recursive: true });
  await NodeFs.writeFile(target, header(from, to) + (rewrite ? rewrite(text) : text));
}

const manifest = {
  name: "sketcher",
  private: true,
  version: `0.0.0-${revision.slice(0, 12)}`,
  type: "module",
  exports: {
    ".": "./src/index.ts",
    "./vite": "./vite/claudeBridge.ts",
  },
  dependencies: upstream.dependencies,
};
await NodeFs.writeFile(
  NodePath.join(destination, "package.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
await NodeFs.writeFile(
  NodePath.join(destination, "README.md"),
  `# Sketcher board

This is the whiteboard from [koaning/sketcher](https://github.com/koaning/sketcher), vendored at
\`${revision}\` for the launcher's Drawing view. The board's own tests live upstream.

Change the board in Sketcher, then run \`bun run sketcher <sketcher checkout>\` to copy
it here again. Repository checks skip this directory.
`,
);
console.log(`Vendored koaning/sketcher@${revision} into ${destination}`);
