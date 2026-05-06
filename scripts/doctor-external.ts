import { runExternalCommand } from "@/server/externalCommand";
import path from "node:path";
import { commandLabel, hasFlag, ireeCompileCommandCandidates, parseArgs, scaleSimCommandCandidates } from "./external-utils";
import { withPrependedPythonPath } from "@/server/externalToolCandidates";

interface Check { name: string; ok: boolean; detail: string; command?: string; }

async function checkHelp(name: string, command: string, args: string[], env?: Record<string, string | undefined>): Promise<Check> {
  try {
    const res = await runExternalCommand(command, args, {
      cwd: process.cwd(),
      timeoutMs: 10_000,
      maxOutputBytes: 30_000,
      env
    });
    const detail = (res.stdout || res.stderr).split(/\r?\n/).find(Boolean)?.slice(0, 240) || commandLabel(command);
    return { name, ok: true, detail, command: commandLabel(command) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, ok: false, detail: message, command: commandLabel(command) };
  }
}

async function checkAnyHelp(name: string, commands: string[], args: string[], env?: Record<string, string | undefined>): Promise<Check> {
  const failures: Check[] = [];
  for (const command of commands) {
    const check = await checkHelp(name, command, args, env);
    if (check.ok) return check;
    failures.push(check);
  }
  return {
    name,
    ok: false,
    detail: failures.map(f => `${f.command}: ${f.detail}`).join(" | "),
    command: commands.map(commandLabel).join(" | ")
  };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const requireExternal = hasFlag(opts, "require-external");
  const scaleCommands = scaleSimCommandCandidates(process.env.TILEFORGE_SCALE_SIM_CMD);
  const ireeCommands = ireeCompileCommandCandidates(process.env.TILEFORGE_IREE_COMPILE_CMD);

  const checks = [
    await checkAnyHelp("SCALE-Sim", scaleCommands, ["-h"], withPrependedPythonPath(path.resolve("external/SCALE-Sim"))),
    await checkAnyHelp("IREE compiler", ireeCommands, ["--version"])
  ];

  for (const c of checks) console.log(`${c.ok ? "✓" : "!"} ${c.name}${c.command ? ` (${c.command})` : ""}: ${c.detail}`);
  const ok = checks.every(c => c.ok);
  if (!ok) {
    console.log("\nInstall hints:");
    console.log("- SCALE-Sim: npm run setup:scalesim -- --force");
    console.log("- SCALE-Sim command fallback order: TILEFORGE_SCALE_SIM_CMD, external/SCALE-Sim source paths, py -3/python module fallback on Windows; python3 is only used on non-Windows or when TILEFORGE_PYTHON=python3");
    console.log("- IREE stable packages: npm run setup:iree");
    console.log("- If iree-compile is installed but not on PATH: export PATH=$HOME/.local/bin:$PATH");
    console.log("- Or force module fallback: TILEFORGE_IREE_COMPILE_CMD=\"py -3 -m iree.compiler.tools.scripts.iree_compile\" npm run validate:external");
    console.log("- Mock mode: TILEFORGE_SCALE_SIM_CMD=\"npx tsx scripts/mock-scalesim.ts\" TILEFORGE_IREE_COMPILE_CMD=\"npx tsx scripts/mock-iree-compile.ts\" npm run validate:external");
  }
  process.exit(ok || !requireExternal ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
