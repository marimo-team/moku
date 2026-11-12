import * as Vite from "vite-plus";

export default Vite.defineConfig({
  test: { include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"] },
  fmt: { printWidth: 88 },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["packages/@moku-outputs/bundle/**"],
  },
});
