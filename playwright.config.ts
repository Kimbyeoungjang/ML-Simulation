import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: () => {} });

const webPort = process.env.TILEFORGE_WEB_PORT ?? process.env.PORT ?? "3000";
const rawHost = process.env.TILEFORGE_WEB_HOST ?? process.env.HOSTNAME ?? "127.0.0.1";
const webHost = rawHost === "0.0.0.0" ? "127.0.0.1" : rawHost;
const baseURL = `http://${webHost}:${webPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:web",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
