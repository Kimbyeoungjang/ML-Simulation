import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    exclude: ["node_modules/**", "dist/**", "build/**", "coverage/**", "tests/e2e/**"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 15_000,
    hookTimeout: 15_000,
    teardownTimeout: 5_000,
  }
});
