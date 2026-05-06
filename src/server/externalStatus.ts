import path from "node:path";
import { runExternalCommand } from "./externalCommand";
import { commandLabel, formatCandidateErrors, ireeCompileCommandCandidates, scaleSimCommandCandidates, withPrependedPythonPath } from "./externalToolCandidates";

export type ExternalToolStatus = {
  available: boolean;
  configured: boolean;
  command: string | null;
  checkedAt: string;
  error?: string;
};

export type ExternalToolsStatus = {
  scalesim: boolean;
  iree: boolean;
  mlirOpt: boolean;
  nodeEnv: string;
  detail: {
    scalesim: ExternalToolStatus;
    iree: ExternalToolStatus;
    mlirOpt: ExternalToolStatus;
  };
};

type CacheEntry = { expiresAt: number; value: ExternalToolsStatus };
let cache: CacheEntry | undefined;

async function probeCandidates(
  commands: string[],
  probeArgs: string[],
  options?: { env?: Record<string, string | undefined>; timeoutMs?: number }
): Promise<{ ok: boolean; command: string | null; error?: string }> {
  const errors: Array<{ command: string; message: string }> = [];
  for (const command of commands) {
    try {
      await runExternalCommand(command, probeArgs, {
        cwd: process.cwd(),
        timeoutMs: options?.timeoutMs ?? 5_000,
        maxOutputBytes: 20_000,
        env: options?.env
      });
      return { ok: true, command: commandLabel(command) };
    } catch (error) {
      errors.push({ command: commandLabel(command), message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { ok: false, command: null, error: formatCandidateErrors(errors) };
}

export async function getExternalToolsStatus(force = false): Promise<ExternalToolsStatus> {
  const now = Date.now();
  if (!force && cache && cache.expiresAt > now) return cache.value;

  const checkedAt = new Date().toISOString();
  const mlirOptCmd = process.env.TILEFORGE_MLIR_OPT_CMD?.trim();
  const [scale, iree, mlir] = await Promise.all([
    probeCandidates(scaleSimCommandCandidates(), ["-h"], {
      timeoutMs: 5_000,
      env: withPrependedPythonPath(path.resolve("external/SCALE-Sim"))
    }),
    probeCandidates(ireeCompileCommandCandidates(), ["--version"], { timeoutMs: 5_000 }),
    mlirOptCmd
      ? probeCandidates([mlirOptCmd], ["--version"], { timeoutMs: 5_000 })
      : Promise.resolve({ ok: false, command: null, error: "TILEFORGE_MLIR_OPT_CMD가 설정되지 않았습니다." })
  ]);

  const value: ExternalToolsStatus = {
    scalesim: scale.ok,
    iree: iree.ok,
    mlirOpt: mlir.ok,
    nodeEnv: process.env.NODE_ENV ?? "development",
    detail: {
      scalesim: { available: scale.ok, configured: Boolean(process.env.TILEFORGE_SCALE_SIM_CMD), command: scale.command, checkedAt, error: scale.error },
      iree: { available: iree.ok, configured: Boolean(process.env.TILEFORGE_IREE_COMPILE_CMD), command: iree.command, checkedAt, error: iree.error },
      mlirOpt: { available: mlir.ok, configured: Boolean(process.env.TILEFORGE_MLIR_OPT_CMD), command: mlir.command, checkedAt, error: mlir.error }
    }
  };
  cache = { expiresAt: now + Number(process.env.TILEFORGE_EXTERNAL_STATUS_CACHE_MS ?? 10_000), value };
  return value;
}
