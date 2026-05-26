import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { runExternalCommand } from "@/server/externalCommand";
import { commandLabel, ireeCompileCommandCandidates, scaleSimCommandCandidates, withPrependedPythonPath } from "@/server/externalToolCandidates";
import { upsertProjectDotEnv } from "@/server/env";

async function firstWorkingCommand(
  label: string,
  commands: string[],
  args: string[],
  options?: { env?: Record<string, string | undefined>; timeoutMs?: number; cwd?: string }
): Promise<{ command?: string; failures: string[] }> {
  const failures: string[] = [];
  const cwd = options?.cwd ?? process.cwd();
  await mkdir(cwd, { recursive: true });
  for (const command of commands) {
    try {
      await runExternalCommand(command, args, {
        cwd,
        timeoutMs: options?.timeoutMs ?? 10_000,
        maxOutputBytes: 30_000,
        env: options?.env
      });
      return { command: commandLabel(command), failures };
    } catch (error) {
      failures.push(`${commandLabel(command)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.warn(`WARNING: ${label} working command not found.`);
  for (const f of failures.slice(0, 5)) console.warn(`  - ${f}`);
  if (failures.length > 5) console.warn(`  ... ${failures.length - 5} more failures omitted`);
  return { failures };
}

function quoteCommandToken(token: string): string {
  return /\s/.test(token) ? `"${token.replace(/"/g, '\\"')}"` : token;
}

function cwdIndependentConfiguredCommand(command: string | undefined): string | undefined {
  if (!command?.trim()) return undefined;
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map(t => t.replace(/^(['"])(.*)\1$/, "$2")) ?? [];
  if (!tokens.length) return command;
  const rewritten = tokens.map(token => {
    if (path.isAbsolute(token)) return token;
    if (!/[\/]/.test(token)) return token;
    const candidate = path.resolve(token);
    return existsSync(candidate) ? candidate : token;
  });
  return rewritten.map(quoteCommandToken).join(" ");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(v => v.trim()).map(v => v.trim())));
}

async function main() {
  const values: Record<string, string> = {};

  // Probe SCALE-Sim from a non-root cwd. Older SCALE-Sim versions write
  // COMPUTE_REPORT.csv to cwd, and TileForge intentionally runs SCALE-Sim from
  // an output directory. A relative source path like external\\SCALE-Sim\\... may
  // pass a root-level `-h` probe but fail in the real worker; probing from here
  // catches that and replaces it with a cwd-independent module command or an
  // absolute source-script command.
  const scaleProbeCwd = path.resolve(".tileforge", "env-probe", "scalesim");
  const configuredScale = cwdIndependentConfiguredCommand(process.env.TILEFORGE_SCALE_SIM_CMD?.trim());
  const scaleCommands = unique([
    ...(configuredScale ? [configuredScale] : []),
    ...scaleSimCommandCandidates(undefined, { ignoreEnv: true })
  ]);
  const scale = await firstWorkingCommand(
    "SCALE-Sim",
    scaleCommands,
    ["-h"],
    { env: withPrependedPythonPath(path.resolve("external/SCALE-Sim")), timeoutMs: 10_000, cwd: scaleProbeCwd }
  );
  if (scale.command && scale.command !== configuredScale) values.TILEFORGE_SCALE_SIM_CMD = scale.command;

  const configuredIree = cwdIndependentConfiguredCommand(process.env.TILEFORGE_IREE_COMPILE_CMD?.trim());
  const ireeCommands = unique([
    ...(configuredIree ? [configuredIree] : []),
    ...ireeCompileCommandCandidates(undefined, { ignoreEnv: true })
  ]);
  const iree = await firstWorkingCommand("IREE compiler", ireeCommands, ["--version"], { timeoutMs: 10_000 });
  if (iree.command && iree.command !== configuredIree) values.TILEFORGE_IREE_COMPILE_CMD = iree.command;


  const defaultEnv: Record<string, string> = {
    TILEFORGE_MAX_PARALLEL_JOBS: "2",
    TILEFORGE_MAX_QUEUED_JOBS: "10000",
    TILEFORGE_JOB_TIMEOUT_MS: "1800000",
    TILEFORGE_JOB_MAX_ATTEMPTS: "1",
    TILEFORGE_MAX_JOB_LOG_LINES: "300",
    TILEFORGE_SQLITE_PRIMARY: "1",
    TILEFORGE_KEEP_EXTERNAL_RAW: "0",
    TILEFORGE_EXTERNAL_KEEP_REPORT_MAX_BYTES: String(25 * 1024 * 1024),
    TILEFORGE_MAX_EXTERNAL_OUTPUT_BYTES: "2000000",
    TILEFORGE_MAX_ARTIFACTS_MB: "256",
    TILEFORGE_MAX_BUNDLE_MB: "512",
    TILEFORGE_EXTERNAL_STATUS_CACHE_MS: "10000",
    TILEFORGE_MAX_CANDIDATES: "20000",
    TILEFORGE_HEATMAP_MAX_POINTS: "5000",
    TILEFORGE_DISABLE_SQLITE: "0",
    TILEFORGE_DISABLE_CACHE: "0",
  };
  for (const [key, value] of Object.entries(defaultEnv)) {
    if (!process.env[key]?.trim()) values[key] = value;
  }

  const result = upsertProjectDotEnv(values, process.cwd(), { overwrite: true });
  if (result.created) console.log(`created .env: ${result.path}`);
  if (result.writtenKeys.length) {
    console.log(`updated .env keys: ${result.writtenKeys.join(", ")}`);
    for (const key of result.writtenKeys) console.log(`${key}=${values[key]}`);
  } else {
    console.log(`.env already contains working external tool commands: ${result.path}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
