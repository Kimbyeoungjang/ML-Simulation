import { runExternalCommand } from "@/server/externalCommand";
export interface DryRunResult { ok: boolean; tool: string; command: string; output: string; }
export async function runDryRun(tool: "mlir-opt" | "iree-compile", inputFile: string, extraArgs: string[] = []): Promise<DryRunResult> {
  const cmd = tool === "mlir-opt" ? (process.env.TILEFORGE_MLIR_OPT_CMD ?? "mlir-opt") : (process.env.TILEFORGE_IREE_COMPILE_CMD ?? "iree-compile");
  const args = tool === "mlir-opt" ? [inputFile, "--verify-diagnostics", ...extraArgs] : [inputFile, "--compile-to=flow", ...extraArgs];
  try {
    const result = await runExternalCommand(cmd, args, { cwd: process.cwd(), timeoutMs: Number(process.env.TILEFORGE_DRYRUN_TIMEOUT_MS ?? 30_000), maxOutputBytes: 200_000 });
    return { ok: true, tool, command: `${cmd} ${args.join(" ")}`, output: `${result.stdout}\n${result.stderr}` };
  } catch (e: any) {
    return { ok: false, tool, command: `${cmd} ${args.join(" ")}`, output: e?.message ?? String(e) };
  }
}
