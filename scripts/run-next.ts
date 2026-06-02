import { spawn } from "node:child_process";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: () => {} });

const mode = process.argv[2] === "start" ? "start" : "dev";

function resolvePort(): string {
  const raw = process.env.TILEFORGE_WEB_PORT ?? process.env.PORT ?? "3000";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid TileForge web port: ${raw}. Use 1-65535.`);
  }
  return String(port);
}

function resolveHost(): string {
  return (process.env.TILEFORGE_WEB_HOST ?? process.env.HOSTNAME ?? "127.0.0.1").trim() || "127.0.0.1";
}

const port = resolvePort();
const host = resolveHost();
const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
const nextBin = process.platform === "win32" ? "next.cmd" : "next";
const args = [mode, "-H", host, "-p", port];

console.log(`[tileforge-web] next ${mode} listening on http://${displayHost}:${port}`);
if (process.env.NEXT_PUBLIC_TILEFORGE_API_BASE_URL?.trim()) {
  console.log(`[tileforge-web] browser API base: ${process.env.NEXT_PUBLIC_TILEFORGE_API_BASE_URL.trim()}`);
}

const child = spawn(nextBin, args, {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    PORT: port,
    HOSTNAME: host,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
