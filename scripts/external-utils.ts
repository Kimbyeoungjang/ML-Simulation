import { access, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateAll } from "@/lib/estimator";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import type { HardwareConfig, MatmulShape, TileCandidates } from "@/types/domain";
import type { SearchResponse } from "@/types/domain";
import { absolutizeConfiguredToolCommand, commandLabel, formatCandidateErrors, ireeCompileCommandCandidates, scaleSimArgs, scaleSimCommandCandidates, withPrependedPythonPath } from "@/server/externalToolCandidates";
export { absolutizeConfiguredToolCommand, commandLabel, formatCandidateErrors, ireeCompileCommandCandidates, scaleSimArgs, scaleSimCommandCandidates } from "@/server/externalToolCandidates";

export interface CliOptions { [key: string]: string | boolean | undefined; }

export function parseArgs(argv = process.argv.slice(2)): CliOptions {
  const out: CliOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const eq = token.indexOf("=");
    if (eq >= 0) {
      out[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export function getStringOpt(opts: CliOptions, key: string, fallback: string): string {
  const value = opts[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function hasFlag(opts: CliOptions, key: string): boolean {
  return opts[key] === true || opts[key] === "true" || opts[key] === "1";
}

export async function makeDemoArtifacts(outDir: string, mode: "smoke" | "default" = "default"): Promise<SearchResponse> {
  await mkdir(outDir, { recursive: true });
  const smokeHardware: HardwareConfig = { ...defaultHardware, name: "SCALE-Sim smoke 8x8", arrayRows: 8, arrayCols: 8, sramKB: 768 };
  const smokeShapes: MatmulShape[] = [
    { id: "smoke_matmul", model: "smoke", opName: "tiny_matmul", m: 8, n: 8, k: 8, dtypeBytes: 2, source: "manual" }
  ];
  const smokeCandidates: TileCandidates = { tileM: [4, 8], tileN: [4, 8], tileK: [4, 8] };
  const response = estimateAll({
    hardware: mode === "smoke" ? smokeHardware : defaultHardware,
    shapes: mode === "smoke" ? smokeShapes : defaultShapes,
    candidates: mode === "smoke" ? smokeCandidates : defaultCandidates,
    objective: "balanced"
  });
  await writeArtifacts(outDir, response);
  return response;
}

export async function writeArtifacts(outDir: string, response: SearchResponse): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "result.json"), JSON.stringify(response, null, 2), "utf8");
  await writeFile(path.join(outDir, "best_tile_policy.csv"), response.artifacts.policyCsv, "utf8");
  await writeFile(path.join(outDir, "generated.mlir"), response.artifacts.mlir, "utf8");
  await writeFile(path.join(outDir, "transform.mlir"), response.artifacts.transformDialect, "utf8");
  await writeFile(path.join(outDir, "scalesim.cfg"), response.artifacts.scaleSimConfig, "utf8");
  await writeFile(path.join(outDir, "topology.csv"), response.artifacts.scaleSimTopology, "utf8");
  await writeFile(path.join(outDir, "layout.csv"), response.artifacts.scaleSimLayout ?? "", "utf8");
  await writeFile(path.join(outDir, "report.md"), response.artifacts.reportMarkdown, "utf8");
}

export async function missingArtifactInputs(root: string, names: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const name of names) {
    try {
      await access(path.join(root, name));
    } catch {
      missing.push(name);
    }
  }
  return missing;
}

export async function ensureArtifactInputs(
  root: string,
  names: string[],
  options: { allowDemoIfMissing?: boolean } = {},
): Promise<{ root: string; missing: string[]; createdDemo: boolean }> {
  const missing = await missingArtifactInputs(root, names);
  if (!missing.length) return { root, missing: [], createdDemo: false };
  if (options.allowDemoIfMissing === false) {
    throw new Error(`missing artifact input(s): ${missing.join(", ")}`);
  }
  await makeDemoArtifacts(root, "smoke");
  const stillMissing = await missingArtifactInputs(root, names);
  if (stillMissing.length) throw new Error(`missing artifact input(s): ${stillMissing.join(", ")}`);
  return { root, missing, createdDemo: true };
}

export function csvRows(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

export function numberFromRow(row: Record<string, string>, names: string[]): number | undefined {
  for (const name of names) {
    const value = row[name];
    if (value === undefined) continue;
    const n = Number(String(value).replace(/[% ,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function defaultIreeCompileCommand(): string {
  return process.env.TILEFORGE_IREE_COMPILE_CMD ?? "iree-compile";
}

export async function runFirstSuccessfulExternalCommand(
  commands: string[],
  args: string[],
  optionsFactory: (command: string) => import("@/server/externalCommand").ExternalCommandOptions
): Promise<{ command: string; result: import("@/server/externalCommand").ExternalCommandResult; errors: Array<{ command: string; message: string }> }> {
  const { runExternalCommand } = await import("@/server/externalCommand");
  const errors: Array<{ command: string; message: string }> = [];
  for (const command of commands) {
    try {
      const result = await runExternalCommand(command, args, optionsFactory(command));
      return { command, result, errors };
    } catch (error) {
      errors.push({ command: commandLabel(command), message: error instanceof Error ? error.message : String(error) });
    }
  }
  const message = formatCandidateErrors(errors);
  throw new Error(message || "No external command candidates were available");
}

export async function findFirstExistingFile(root: string, fileName: string, maxDepth = 8): Promise<string | undefined> {
  const wanted = fileName.toLowerCase();
  async function walk(dir: string, depth: number): Promise<string | undefined> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === wanted) return full;
    }

    // SCALE-Sim versions sometimes put reports in nested run-name/output folders,
    // and a few forks vary the exact capitalization. Prefer exact match above,
    // then accept a conservative compute-report-looking CSV.
    for (const entry of entries) {
      const lower = entry.name.toLowerCase();
      const full = path.join(dir, entry.name);
      if (entry.isFile() && lower.endsWith(".csv") && lower.includes("compute") && lower.includes("report")) {
        return full;
      }
    }

    if (depth <= 0) return undefined;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      try {
        const info = await stat(full);
        if (!info.isDirectory()) continue;
      } catch {
        continue;
      }
      const found = await walk(full, depth - 1);
      if (found) return found;
    }
    return undefined;
  }
  return walk(root, maxDepth);
}

export async function listFilesForDiagnostics(root: string, maxDepth = 4): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full) || entry.name;
      if (entry.isFile()) files.push(rel);
      else if (entry.isDirectory() && depth > 0) await walk(full, depth - 1);
    }
  }
  await walk(root, maxDepth);
  return files.sort();
}


export interface ScaleSimRunResult {
  command: string;
  result: import("@/server/externalCommand").ExternalCommandResult;
  computeReport: string;
  errors: Array<{ command: string; message: string }>;
}

export async function runScaleSimUntilReport(
  commands: string[],
  args: string[],
  outDir: string,
  optionsFactory: (command: string) => import("@/server/externalCommand").ExternalCommandOptions
): Promise<ScaleSimRunResult> {
  const { runExternalCommand } = await import("@/server/externalCommand");
  const errors: Array<{ command: string; message: string }> = [];

  for (const command of commands) {
    try {
      const options = optionsFactory(command);
      const result = await runExternalCommand(command, args, {
        ...options,
        env: withPrependedPythonPath(path.resolve("external/SCALE-Sim"), options.env)
      });
      const computeReport = await findFirstExistingFile(outDir, "COMPUTE_REPORT.csv");
      if (computeReport) return { command, result, computeReport, errors };

      const files = await listFilesForDiagnostics(outDir, 3);
      errors.push({
        command: commandLabel(command),
        message: `command exited successfully, but COMPUTE_REPORT.csv was not produced. Files under output: ${files.length ? files.join(", ") : "(none)"}`
      });
    } catch (error) {
      errors.push({ command: commandLabel(command), message: error instanceof Error ? error.message : String(error) });
    }
  }

  const message = formatCandidateErrors(errors);
  throw new Error(message || `SCALE-Sim did not produce COMPUTE_REPORT.csv under ${outDir}`);
}

