import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { runExternalCommand } from "./externalCommand";
import { commandLabel, ireeCompileCommandCandidates, scaleSimCommandCandidates, withPrependedPythonPath } from "./externalToolCandidates";
import { getWorkspaceRoot, ensureJobRoot } from "./workspace";
import { sqliteStatus, getSqliteDb } from "./sqliteStore";

export interface DoctorCheck { name: string; ok: boolean; detail: string; }
export interface DoctorReport { ok: boolean; checks: DoctorCheck[]; }

async function checkExternalTool(name: string, commands: string[], args: string[], env?: Record<string, string | undefined>): Promise<DoctorCheck> {
  const failures: string[] = [];
  for (const command of commands) {
    try {
      const res = await runExternalCommand(command, args, {
        cwd: process.cwd(),
        timeoutMs: 10_000,
        maxOutputBytes: 30_000,
        env
      });
      const firstLine = (res.stdout || res.stderr).split(/\r?\n/).find(Boolean)?.slice(0, 240);
      return { name, ok: true, detail: `${commandLabel(command)}${firstLine ? ` — ${firstLine}` : ""}` };
    } catch (error) {
      failures.push(`${commandLabel(command)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { name, ok: false, detail: failures.length ? failures.join(" | ") : "not configured" };
}

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const root = getWorkspaceRoot();
  try { await mkdir(root, { recursive: true }); await access(root); checks.push({ name: "workspace", ok: true, detail: root }); } catch (e:any) { checks.push({ name: "workspace", ok: false, detail: e.message }); }
  try { await ensureJobRoot(); checks.push({ name: "job-root", ok: true, detail: path.join(root, "jobs") }); } catch (e:any) { checks.push({ name: "job-root", ok: false, detail: e.message }); }
  checks.push({ name: "node", ok: true, detail: process.version });
  try { const db = getSqliteDb(); checks.push({ name: "sqlite", ok: !!db, detail: db ? "available" : JSON.stringify(sqliteStatus()) }); } catch (e:any) { checks.push({ name: "sqlite", ok: false, detail: e.message }); }
  checks.push(await checkExternalTool("scalesim", scaleSimCommandCandidates(), ["-h"], withPrependedPythonPath(path.resolve("external/SCALE-Sim"))));
  checks.push(await checkExternalTool("iree", ireeCompileCommandCandidates(), ["--version"]));
  return { ok: checks.filter(c => ["workspace", "job-root", "node"].includes(c.name)).every(c => c.ok), checks };
}

export function toolAvailability() {
  return {
    scalesim: { configured: Boolean(process.env.TILEFORGE_SCALE_SIM_CMD), command: process.env.TILEFORGE_SCALE_SIM_CMD ?? null, candidates: scaleSimCommandCandidates() },
    iree: { configured: Boolean(process.env.TILEFORGE_IREE_COMPILE_CMD), command: process.env.TILEFORGE_IREE_COMPILE_CMD ?? null, candidates: ireeCompileCommandCandidates() },
    timeloop: { configured: Boolean(process.env.TILEFORGE_TIMELOOP_CMD), command: process.env.TILEFORGE_TIMELOOP_CMD ?? null },
    maestro: { configured: Boolean(process.env.TILEFORGE_MAESTRO_CMD), command: process.env.TILEFORGE_MAESTRO_CMD ?? null }
  };
}
