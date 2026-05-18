import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EstimatorSuiteModel } from "@/lib/estimatorSuite";
import { getWorkspaceRoot } from "./workspace";

export interface EstimatorSuiteModelEntry {
  runId: string;
  path: string;
  createdAt: string;
  samples?: number;
  recommended?: string;
  active: boolean;
}

function suiteRoot() { return path.join(getWorkspaceRoot(), "estimator-suite"); }
function activeModelPath() { return path.join(suiteRoot(), "active-estimator-suite-model.json"); }
function activeMetaPath() { return path.join(suiteRoot(), "active-estimator-suite.json"); }

async function readJson(file: string): Promise<any | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return undefined; }
}

export async function readActiveEstimatorSuiteModel(): Promise<EstimatorSuiteModel | undefined> {
  const model = await readJson(activeModelPath());
  return model?.kind === "tileforge-estimator-suite-v1" ? model as EstimatorSuiteModel : undefined;
}

export async function readActiveEstimatorSuiteMeta(): Promise<any | undefined> {
  return await readJson(activeMetaPath());
}

export async function listEstimatorSuiteModels(): Promise<{ activeRunId?: string; activePath?: string; models: EstimatorSuiteModelEntry[] }> {
  await mkdir(suiteRoot(), { recursive: true });
  const active = await readActiveEstimatorSuiteMeta();
  const dirs = await readdir(suiteRoot(), { withFileTypes: true });
  const models: EstimatorSuiteModelEntry[] = [];
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const runId = d.name;
    const file = path.join(suiteRoot(), runId, "estimator-suite-model.json");
    const model = await readJson(file);
    if (model?.kind !== "tileforge-estimator-suite-v1") continue;
    const st = await stat(file).catch(() => undefined);
    models.push({
      runId,
      path: file,
      createdAt: model.createdAt ?? st?.mtime?.toISOString?.() ?? new Date(0).toISOString(),
      samples: model.metadata?.samples,
      recommended: model.recommended,
      active: active?.runId === runId,
    });
  }
  models.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { activeRunId: active?.runId, activePath: active?.path, models };
}

export async function activateEstimatorSuiteModel(runId: string): Promise<{ runId: string; path: string; model: EstimatorSuiteModel }> {
  await mkdir(suiteRoot(), { recursive: true });
  const safeRunId = path.basename(runId);
  const file = path.join(suiteRoot(), safeRunId, "estimator-suite-model.json");
  const model = await readJson(file);
  if (model?.kind !== "tileforge-estimator-suite-v1") throw new Error(`Estimator suite model not found for run ${safeRunId}`);
  await copyFile(file, activeModelPath());
  await writeFile(activeMetaPath(), JSON.stringify({ runId: safeRunId, path: file, activatedAt: new Date().toISOString(), samples: model.metadata?.samples, recommended: model.recommended, weights: model.weights }, null, 2), "utf8");
  return { runId: safeRunId, path: file, model };
}

export async function clearActiveEstimatorSuiteModel(): Promise<void> {
  await mkdir(suiteRoot(), { recursive: true });
  await writeFile(activeMetaPath(), JSON.stringify({ clearedAt: new Date().toISOString() }, null, 2), "utf8");
  await writeFile(activeModelPath(), "{}", "utf8");
}
