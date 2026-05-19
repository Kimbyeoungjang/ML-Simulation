import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { environment: "node", setupFiles: ["tests/setup.ts"], exclude: ["node_modules/**", "dist/**", "build/**", "coverage/**", "tests/e2e/**"] }
});
