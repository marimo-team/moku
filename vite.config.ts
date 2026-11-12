import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: { printWidth: 88 },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["packages/@moku-outputs/bundle/**"],
  },
});
