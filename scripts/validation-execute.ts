import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildValidationRunbook, validationRunbookJson, validationRunbookMarkdown, type ValidationRunbook, type ValidationRunbookCommand } from "@/lib/validationRunbook";
import type { ValidationPlan } from "@/lib/validationPlan";
import {
  buildValidationExecutionReport,
  executionPreflight,
  recordFromCommand,
  selectValidationRunbookCommands,
  validationExecutionReportJson,
  validationExecutionReportMarkdown,
  type ValidationExecutionOptions,
  type ValidationExecutionRecord,
} from "@/lib/validationExecutionReport";
import { getStringOpt, hasFlag, parseArgs } from "./external-utils";

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

function parseKinds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map((x) => x.trim()).filter(Boolean);
  return [];
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}


async function readRunbookOrBuild(input: {
  artifactDir: string;
  runbookPath: string;
  outDir: string;
  maxCommands?: number;
}): Promise<ValidationRunbook> {
  try {
    return await readJson<ValidationRunbook>(input.runbookPath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    const planPath = path.join(input.artifactDir, "validation_plan.json");
    try {
      const plan = await readJson<ValidationPlan>(planPath);
      const runbook = buildValidationRunbook({ plan, artifactDir: input.artifactDir, maxCommands: input.maxCommands });
      await mkdir(input.outDir, { recursive: true });
      await writeFile(path.join(input.outDir, "validation_runbook.json"), validationRunbookJson(runbook), "utf8");
      await writeFile(path.join(input.outDir, "validation_runbook.md"), validationRunbookMarkdown(runbook), "utf8");
      return runbook;
    } catch (planError: any) {
      if (planError?.code !== "ENOENT") throw planError;
      throw new Error(`validation_runbook.json not found at ${input.runbookPath}. Generate it with: npm run validation:plan -- --artifact ${input.artifactDir}`);
    }
  }
}

function runCommand(command: ValidationRunbookCommand): Promise<ValidationExecutionRecord> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command.command, {
      cwd: command.cwd === "." ? process.cwd() : path.resolve(command.cwd),
      shell: true,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 20000) stdout = stdout.slice(-20000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on("error", (error) => {
      resolve(recordFromCommand(command, "failed", `spawn error: ${error.message}`, {
        exitCode: null,
        durationMs: Date.now() - start,
        stdoutTail: stdout,
        stderrTail: stderr,
      }));
    });
    child.on("close", (code) => {
      resolve(recordFromCommand(command, code === 0 ? "passed" : "failed", code === 0 ? "command exited successfully" : `command exited with ${code}`, {
        exitCode: code,
        durationMs: Date.now() - start,
        stdoutTail: stdout,
        stderrTail: stderr,
      }));
    });
  });
}

async function main(): Promise<void> {
  const optsRaw = parseArgs();
  const artifactDir = path.resolve(getStringOpt(optsRaw, "artifact", path.join(".tileforge", "external", "artifact")));
  const runbookPath = path.resolve(getStringOpt(optsRaw, "runbook", path.join(artifactDir, "validation_runbook.json")));
  const outDir = path.resolve(getStringOpt(optsRaw, "out", artifactDir));
  const execute = hasFlag(optsRaw, "execute");
  const allowExternal = hasFlag(optsRaw, "allow-external");
  const allowReadOnly = !hasFlag(optsRaw, "no-read-only");
  const stopOnFailure = !hasFlag(optsRaw, "no-stop-on-failure");
  const maxCommands = parseNumber(optsRaw["max-commands"]);
  const kinds = parseKinds(optsRaw.kind ?? optsRaw.kinds);
  const runbook = await readRunbookOrBuild({ artifactDir, runbookPath, outDir, maxCommands });
  const execOpts: ValidationExecutionOptions = {
    execute,
    allowExternal,
    allowReadOnly,
    stopOnFailure,
    maxCommands,
    kinds,
  };

  const selected = selectValidationRunbookCommands(runbook, execOpts);
  const records: ValidationExecutionRecord[] = [];
  let stopped = false;

  for (const command of selected) {
    if (stopped) {
      records.push(recordFromCommand(command, "skipped", "previous command failed/blocked and stopOnFailure=true"));
      continue;
    }
    const preflight = executionPreflight(command, execOpts);
    if (!preflight.executable) {
      records.push(recordFromCommand(command, preflight.status, preflight.reason));
      if (stopOnFailure && (preflight.status === "failed" || preflight.status === "blocked")) stopped = true;
      continue;
    }
    const record = await runCommand(command);
    records.push(record);
    if (stopOnFailure && (record.status === "failed" || record.status === "blocked")) stopped = true;
  }

  const report = buildValidationExecutionReport({ runbook, records, opts: execOpts });
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "validation_execution_report.json");
  const mdPath = path.join(outDir, "validation_execution_report.md");
  await writeFile(jsonPath, validationExecutionReportJson(report), "utf8");
  await writeFile(mdPath, validationExecutionReportMarkdown(report), "utf8");
  console.log(`validation execution report written: ${mdPath}`);
  console.log(`mode=${report.mode} passed=${report.summary.passed} failed=${report.summary.failed} blocked=${report.summary.blocked} skipped=${report.summary.skipped}`);
  if (execute && (report.summary.failed > 0 || report.summary.blocked > 0)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
