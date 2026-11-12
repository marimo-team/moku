/**
 * Build the embedded renderer and its declarations into `dist/`.
 *
 * Uses the pinned GitHub checkout prepared by `bun setup`, or `MARIMO_CHECKOUT`.
 * `dist/source.json` records the bundled upstream revision.
 *
 * @module
 */
import * as NodeFs from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeUrl from "node:url";
import * as NodeChildProcess from "node:child_process";
import * as Vite from "vite-plus";
import * as TypeScript from "typescript";
import { checkout } from "../../../scripts/marimo.ts";

const require = NodeModule.createRequire(import.meta.resolve("vite-plus"));
const { esmExternalRequirePlugin } = await import(
  NodeUrl.pathToFileURL(require.resolve("vite/rolldown/plugins")).href
);
const external = /^react(?:-dom)?(?:\/.*)?$/;
const project = NodeUrl.fileURLToPath(new URL("../", import.meta.url));
const frontend = NodePath.join(checkout, "frontend");
const entry = NodePath.join(project, "bundle/renderer.tsx");
const outDir = NodePath.join(project, "dist");

await NodeFs.access(NodePath.join(frontend, "node_modules"));

// Emit the explicit public signature without pulling frontend implementation types
// into the workspace. Consumers typecheck against this generated declaration.
const declaration = TypeScript.transpileDeclaration(
  await NodeFs.readFile(entry, "utf8"),
  {
    fileName: entry,
    compilerOptions: {
      jsx: TypeScript.JsxEmit.ReactJSX,
      module: TypeScript.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
    transformers: {
      afterDeclarations: [
        () => (node) => {
          if (!TypeScript.isSourceFile(node)) return node;
          return TypeScript.factory.updateSourceFile(
            node,
            node.statements.filter((statement) => {
              return !(
                TypeScript.isImportDeclaration(statement) &&
                !statement.importClause &&
                TypeScript.isStringLiteral(statement.moduleSpecifier) &&
                statement.moduleSpecifier.text.endsWith(".css")
              );
            }),
          );
        },
      ],
    },
  },
);
const errors =
  declaration.diagnostics?.filter(
    (diagnostic) => diagnostic.category === TypeScript.DiagnosticCategory.Error,
  ) ?? [];
if (errors.length) {
  throw new Error(
    TypeScript.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => project,
      getNewLine: () => "\n",
    }),
  );
}

process.env.VITE_MARIMO_ISLANDS = "true";
process.env.NODE_ENV = "production";
await Vite.build({
  configFile: false,
  root: frontend,
  publicDir: false,
  plugins: [esmExternalRequirePlugin({ external: [external] })],
  cacheDir: NodePath.join(project, "node_modules/.cache/renderer"),
  resolve: { alias: { "@": NodePath.join(frontend, "src") }, dedupe: ["jotai"] },
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
await NodeFs.writeFile(NodePath.join(outDir, "renderer.d.ts"), declaration.outputText);
const revision = NodeChildProcess.execFileSync(
  "git",
  ["-C", checkout, "rev-parse", "HEAD"],
  {
    encoding: "utf8",
  },
).trim();
await NodeFs.writeFile(
  NodePath.join(outDir, "source.json"),
  JSON.stringify({ revision }, null, 2) + "\n",
);
console.log(`Bundled marimo outputs from ${revision}`);
