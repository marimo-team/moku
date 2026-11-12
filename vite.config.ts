import { defineConfig } from "vite-plus";

export default defineConfig({
  test: { include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"] },
  fmt: { printWidth: 88 },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["packages/@moku-outputs/bundle/**"],
  },
});
