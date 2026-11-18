import * as Vite from "vite-plus";
import { neo4jWidget } from "./apps/@moku-launcher/src/plugins/neo4j/widget/vite.ts";

export default Vite.defineConfig({
  // Tests import the generated Neo4j widget cell.
  plugins: [neo4jWidget()],
  test: {
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["apps/*/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
      reporter: ["text-summary", "html", "lcov", "json-summary"],
      reportOnFailure: true,
    },
  },
  fmt: { printWidth: 88 },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["packages/@moku-outputs/bundle/**"],
  },
});
