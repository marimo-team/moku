import * as Fs from "node:fs/promises";
import * as Module from "node:module";
import * as Os from "node:os";
import * as Path from "node:path";
import * as Url from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "vite-plus";
import ts from "typescript";

const require = Module.createRequire(import.meta.resolve("vite-plus"));
const { esmExternalRequirePlugin } = await import(
  Url.pathToFileURL(require.resolve("vite/rolldown/plugins")).href
);
const external = /^react(?:-dom)?(?:\/.*)?$/;
const project = Url.fileURLToPath(new URL("../", import.meta.url));
const checkout = Path.resolve(
  process.argv[2] ??
    process.env.MARIMO_CHECKOUT ??
    Path.join(Os.homedir(), "github/marimo-team/marimo"),
);
const frontend = Path.join(checkout, "frontend");
const entry = Path.join(project, "bundle/renderer.tsx");
const outDir = Path.join(project, "dist");

await Fs.access(Path.join(frontend, "node_modules"));

// Emit the explicit public signature without pulling frontend implementation types
// into the workspace. Consumers typecheck against this generated declaration.
const declaration = ts.transpileDeclaration(await Fs.readFile(entry, "utf8"), {
  fileName: entry,
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  reportDiagnostics: true,
  transformers: {
    afterDeclarations: [
      () => (node) => {
        if (!ts.isSourceFile(node)) return node;
        return ts.factory.updateSourceFile(
          node,
          node.statements.filter((statement) => {
            return !(
              ts.isImportDeclaration(statement) &&
              !statement.importClause &&
              ts.isStringLiteral(statement.moduleSpecifier) &&
              statement.moduleSpecifier.text.endsWith(".css")
            );
          }),
        );
      },
    ],
  },
});
const errors =
  declaration.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  ) ?? [];
if (errors.length) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => project,
      getNewLine: () => "\n",
    }),
  );
}

process.env.VITE_MARIMO_ISLANDS = "true";
process.env.NODE_ENV = "production";
await build({
  configFile: false,
  root: frontend,
  publicDir: false,
  plugins: [esmExternalRequirePlugin({ external: [external] })],
  cacheDir: Path.join(project, "node_modules/.cache/renderer"),
  resolve: { alias: { "@": Path.join(frontend, "src") }, dedupe: ["jotai"] },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.MODE": JSON.stringify("test"),
    "import.meta.env.VITE_MARIMO_ISLANDS": JSON.stringify("false"),
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
    lib: { entry, formats: ["es"], fileName: "renderer", cssFileName: "renderer" },
    rolldownOptions: {
      onwarn(warning, warn) {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
  },
});
await Fs.writeFile(Path.join(outDir, "renderer.d.ts"), declaration.outputText);
const revision = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
await Fs.writeFile(
  Path.join(outDir, "source.json"),
  JSON.stringify({ revision }, null, 2) + "\n",
);
console.log(`Bundled marimo outputs from ${revision}`);
