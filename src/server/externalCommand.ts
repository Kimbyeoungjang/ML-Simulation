import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TileForgeError } from "@/lib/errors";

export interface ExternalCommandResult { code: number; stdout: string; stderr: string; logPath?: string; signal?: NodeJS.Signals | null; }
export type ExternalCommandEnv = Record<string, string | undefined>;
export interface ExternalCommandOptions { cwd: string; timeoutMs: number; logPath?: string; maxOutputBytes?: number; env?: ExternalCommandEnv; }

export function splitCommand(command: string): { exe: string; args: string[] } {
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(t => t.replace(/^(['"])(.*)\1$/, "$2")) ?? [];
  if (!tokens.length) throw new TileForgeError("EXTERNAL_TOOL_NOT_CONFIGURED", "External command is empty", { recoverable: true });
  return { exe: tokens[0], args: tokens.slice(1) };
}

function safeEnv(extra?: ExternalCommandEnv): NodeJS.ProcessEnv {
  const allow = ["PATH", "Path", "PATHEXT", "HOME", "USER", "USERNAME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "TEMP", "TMP", "TMPDIR", "SYSTEMROOT", "SystemRoot", "ComSpec", "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"];
  const extraAllow = new Set(["PATH", "Path", "PATHEXT", "PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "TEMP", "TMP", "TMPDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA"]);
  const nodeEnv = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development"
    ? process.env.NODE_ENV
    : "development";
  const env: NodeJS.ProcessEnv = { NODE_ENV: nodeEnv };
  for (const k of allow) if (process.env[k]) env[k] = process.env[k];
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (typeof v !== "string") continue;
    if (k.startsWith("TILEFORGE_") || extraAllow.has(k)) env[k] = v;
  }
  return env;
}

function appendLiveLog(logPath: string | undefined, text: string): void {
  if (!logPath) return;
  try { appendFileSync(logPath, text, "utf8"); } catch { /* ignore transient log write failures */ }
}

export async function runExternalCommand(command: string, args: string[], options: ExternalCommandOptions): Promise<ExternalCommandResult> {
  const { exe, args: baseArgs } = splitCommand(command);
  const timeoutMs = options.timeoutMs;
  const maxOutputBytes = options.maxOutputBytes ?? Number(process.env.TILEFORGE_MAX_EXTERNAL_OUTPUT_BYTES ?? 2_000_000);
  let stdout = "";
  let stderr = "";
  let killedByTimeout = false;
  let exitCode = 0;
  let exitSignal: NodeJS.Signals | null = null;
  let spawnError: Error | undefined;
  const fullArgs = [...baseArgs, ...args];
  const resolvedLogPath = options.logPath ? path.resolve(options.logPath) : undefined;

  await mkdir(options.cwd, { recursive: true });
  if (resolvedLogPath) {
    mkdirSync(path.dirname(resolvedLogPath), { recursive: true });
    const loggedCommand = [exe, ...fullArgs].join(" ");
    writeFileSync(resolvedLogPath, [`$ ${loggedCommand}`, `cwd: ${options.cwd}`, `startedAt: ${new Date().toISOString()}`, "", "--- stdout ---", ""].join("\n"), "utf8");
  }

  await new Promise<void>((resolve) => {
    const child = spawn(exe, fullArgs, { cwd: options.cwd, env: safeEnv(options.env), shell: false, detached: process.platform !== "win32" });
    const killTree = () => {
      killedByTimeout = true;
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGTERM");
        else child.kill("SIGTERM");
      } catch { child.kill("SIGTERM"); }
      setTimeout(() => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch {} }, 2_000).unref();
    };
    const timer = setTimeout(killTree, timeoutMs);
    let stderrHeaderWritten = false;
    const append = (kind: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString();
      if (kind === "stdout") {
        stdout = (stdout + text).slice(-maxOutputBytes);
        appendLiveLog(resolvedLogPath, text);
      } else {
        stderr = (stderr + text).slice(-maxOutputBytes);
        if (!stderrHeaderWritten) {
          appendLiveLog(resolvedLogPath, "\n\n--- stderr ---\n");
          stderrHeaderWritten = true;
        }
        appendLiveLog(resolvedLogPath, text);
      }
    };
    child.stdout.on("data", d => append("stdout", d));
    child.stderr.on("data", d => append("stderr", d));
    child.on("error", err => { clearTimeout(timer); spawnError = err; resolve(); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      exitCode = code ?? 0;
      exitSignal = signal;
      resolve();
    });
  });

  if (resolvedLogPath) {
    appendLiveLog(resolvedLogPath, ["", "--- process ---", `finishedAt: ${new Date().toISOString()}`, `exitCode: ${exitCode}`, `signal: ${exitSignal ?? "none"}`, `spawnError: ${spawnError?.message ?? "none"}`, ""].join("\n"));
  }

  if (spawnError) {
    throw new TileForgeError("EXTERNAL_TOOL_FAILED", spawnError.message, { cause: spawnError, recoverable: true, hint: resolvedLogPath ? `log=${resolvedLogPath}` : undefined });
  }
  if (killedByTimeout) {
    throw new TileForgeError("TIMEOUT", `External command timed out after ${timeoutMs} ms`, { recoverable: true, hint: `signal=${exitSignal ?? "none"}${resolvedLogPath ? `, log=${resolvedLogPath}` : ""}` });
  }
  if (exitCode !== 0) {
    throw new TileForgeError("EXTERNAL_TOOL_FAILED", `External command exited with ${exitCode}${exitSignal ? ` (${exitSignal})` : ""}`, { recoverable: true, hint: `code=${exitCode}, signal=${exitSignal ?? "none"}${resolvedLogPath ? `, log=${resolvedLogPath}` : ""}` });
  }
  return { code: exitCode, stdout, stderr, signal: exitSignal, logPath: resolvedLogPath };
}

export async function detectExternalToolVersion(command: string | undefined): Promise<string | undefined> {
  if (!command) return undefined;
  try {
    const res = await runExternalCommand(command, ["--version"], { cwd: process.cwd(), timeoutMs: 5_000, maxOutputBytes: 20_000 });
    return (res.stdout || res.stderr).split(/\r?\n/).find(Boolean)?.slice(0, 300);
  } catch { return undefined; }
}
