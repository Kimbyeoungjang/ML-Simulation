import "./env";
import path from "node:path";
import { pythonCommandCandidates, pythonModuleCommandCandidates, commandLineFor } from "./pythonUtils";

export function commandLabel(command: string): string {
  return command.replace(/\s+/g, " ").trim();
}

export function uniqueCommands(commands: Array<string | undefined>): string[] {
  return Array.from(new Set(commands.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map(v => v.trim())));
}

function splitCommandLine(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if ((ch === '"' || ch === "'") && command[i - 1] !== "\\") {
      quote = quote === ch ? null : quote ? quote : ch;
      current += ch;
      continue;
    }
    if (/\s/.test(ch) && !quote) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return parts;
}

function quoteIfNeeded(value: string) {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function stripQuotes(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function looksLikeRelativeFileOperand(value: string) {
  if (!value || value.startsWith("-") || /^[A-Za-z]:[\\/]/.test(value) || path.isAbsolute(value)) return false;
  return /^(scripts|external|\.\.?[\\/])/.test(value) || /\.(?:py|ts|tsx|js|cjs|mjs|mlir|cfg|csv|json)$/i.test(value);
}

export function absolutizeConfiguredToolCommand(command: string, root = process.cwd()): string {
  const parts = splitCommandLine(command.trim());
  if (!parts.length) return command;
  return parts.map((part) => {
    const unquoted = stripQuotes(part);
    if (!looksLikeRelativeFileOperand(unquoted)) return part;
    return quoteIfNeeded(path.resolve(root, unquoted));
  }).join(" ");
}

function pythonScriptCommandCandidates(scriptPath: string): string[] {
  return pythonCommandCandidates().map(candidate => commandLineFor(candidate, [scriptPath]));
}

export function scaleSimSourceCommandCandidates(): string[] {
  const scriptCandidates = [
    path.resolve("external", "SCALE-Sim", "scalesim", "scale.py"),
    path.resolve("external", "SCALE-Sim", "scale.py")
  ];
  return scriptCandidates.flatMap(script => pythonScriptCommandCandidates(script));
}

export function scaleSimCommandCandidates(preferred?: string, options: { ignoreEnv?: boolean } = {}): string[] {
  const raw = preferred || (options.ignoreEnv ? undefined : process.env.TILEFORGE_SCALE_SIM_CMD);
  // If a command is configured in .env or the process environment, use it as
  // the single source of truth. This prevents noisy fallback probes such as
  // Windows `python3` command-not-found errors after setup has found a working
  // command.
  if (raw?.trim()) return uniqueCommands([absolutizeConfiguredToolCommand(raw)]);

  // Prefer the installed module form because it is independent of cwd.
  // SCALE-Sim is intentionally executed from its output directory so older
  // versions that write COMPUTE_REPORT.csv to cwd do not pollute the repo root.
  // Relative source-script commands break under that cwd; source candidates are
  // therefore absolute and are used only as a fallback.
  return uniqueCommands([
    ...pythonModuleCommandCandidates("scalesim.scale"),
    ...scaleSimSourceCommandCandidates()
  ]);
}

export function ireeCompileCommandCandidates(preferred?: string, options: { ignoreEnv?: boolean } = {}): string[] {
  const raw = preferred || (options.ignoreEnv ? undefined : process.env.TILEFORGE_IREE_COMPILE_CMD);
  // Same rule as SCALE-Sim: a configured command is authoritative.
  if (raw?.trim()) return uniqueCommands([absolutizeConfiguredToolCommand(raw)]);
  return uniqueCommands([
    "iree-compile",
    // The Python package exposes the console entry point through this module.
    // Do not use iree.compiler.tools.core as a CLI candidate: it may exit 0
    // without producing a VMFB, which caused false-positive external checks.
    ...pythonModuleCommandCandidates("iree.compiler.tools.scripts.iree_compile")
  ]);
}

export function withPrependedPythonPath(extraPath: string, env?: Record<string, string | undefined>): Record<string, string | undefined> {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const current = env?.PYTHONPATH ?? process.env.PYTHONPATH;
  return {
    ...env,
    PYTHONPATH: current ? `${extraPath}${delimiter}${current}` : extraPath
  };
}

export interface ScaleSimPathArgs { config: string; topology: string; layout?: string; outDir: string; useLayout?: boolean; }

export function scaleSimArgs(paths: ScaleSimPathArgs): string[] {
  const args = ["-c", paths.config, "-t", paths.topology];
  if (paths.layout && paths.useLayout !== false && process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT !== "0") {
    args.push("-l", paths.layout);
  }
  if (process.env.TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG === "1") {
    args.push("-p", paths.outDir);
  }
  return args;
}

export function isNoisyExternalCandidateFailure(command: string, message: string): boolean {
  const combined = `${command}\n${message}`.toLowerCase();
  return (
    /\bpython3\b/.test(combined) && (
      combined.includes("9009") ||
      combined.includes("not recognized") ||
      combined.includes("not found") ||
      combined.includes("command not found") ||
      combined.includes("python was not found")
    )
  );
}

export function formatCandidateErrors(errors: Array<{ command: string; message: string }>): string {
  const visible = errors.filter(e => !isNoisyExternalCandidateFailure(e.command, e.message));
  const hiddenCount = errors.length - visible.length;
  const lines = visible.map(e => `${e.command}: ${e.message}`);
  if (hiddenCount > 0) lines.push(`(${hiddenCount}개 Windows python3 명령 미탐색 오류는 작업 현황에서 숨겼습니다.)`);
  return lines.join("\n") || "실행 가능한 외부 명령 후보가 없습니다";
}
