import * as Vite from "vite-plus";

export default Vite.defineConfig({
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
