import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildValidationRunbook, validationRunbookJson, validationRunbookMarkdown } from "@/lib/validationRunbook";
import type { ValidationPlan } from "@/lib/validationPlan";
import { getStringOpt, parseArgs } from "./external-utils";

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const artifactDir = path.resolve(getStringOpt(opts, "artifact", path.join(".tileforge", "external", "artifact")));
  const planPath = path.resolve(getStringOpt(opts, "plan", path.join(artifactDir, "validation_plan.json")));
  const outDir = path.resolve(getStringOpt(opts, "out", artifactDir));
  const maxRaw = opts["max-commands"];
  const maxCommands = typeof maxRaw === "string" ? Number(maxRaw) : undefined;
  const plan = await readJson<ValidationPlan>(planPath);
  const runbook = buildValidationRunbook({ plan, artifactDir, maxCommands: Number.isFinite(maxCommands) ? maxCommands : undefined });
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "validation_runbook.json");
  const mdPath = path.join(outDir, "validation_runbook.md");
  await writeFile(jsonPath, validationRunbookJson(runbook), "utf8");
  await writeFile(mdPath, validationRunbookMarkdown(runbook), "utf8");
  console.log(`validation runbook written: ${mdPath}`);
  if (runbook.summary.firstCommand) console.log(`first command: ${runbook.summary.firstCommand}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
