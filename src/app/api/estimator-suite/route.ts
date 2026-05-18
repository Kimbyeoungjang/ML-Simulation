import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { stableId } from "@/lib/determinism";
import { buildEstimatorSuiteArtifacts, designEstimatorSuiteCsv, normalizeSuiteSplitKinds, parseEstimatorSamplesCsv } from "@/lib/estimatorSuiteArtifacts";
import { trainEstimatorSuite } from "@/lib/estimatorSuite";
import { formatZodError, parseSearchRequest } from "@/lib/validation";
import { getWorkspaceRoot } from "@/server/workspace";

function num(body: any, name: string, fallback: number) {
  const v = Number(body?.options?.[name] ?? body?.[name]);
  return Number.isFinite(v) ? v : fallback;
}

async function writeRunArtifacts(runId: string, files: Record<string, string>) {
  const dir = path.join(getWorkspaceRoot(), "estimator-suite", runId);
  await mkdir(dir, { recursive: true });
  const artifacts = [] as Array<{ name: string; path: string }>;
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(dir, name);
    await writeFile(file, content, "utf8");
    artifacts.push({ name, path: file });
  }
  return { dir, artifacts };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = String(body.action ?? "suite");
    const runId = stableId("est_suite");
    if (action === "design") {
      const request = parseSearchRequest(body.request);
      const designCsv = designEstimatorSuiteCsv(request, { topK: num(body, "topK", 3) });
      const { dir, artifacts } = await writeRunArtifacts(runId, { "estimator-suite-design.csv": designCsv });
      return NextResponse.json({ ok: true, action, runId, dir, artifacts, designCsv, rows: Math.max(0, designCsv.split(/\r?\n/).filter(Boolean).length - 1) });
    }

    const csvText = String(body.csvText ?? body.csv ?? "");
    const samples = parseEstimatorSamplesCsv(csvText);
    if (samples.length < 40) {
      return NextResponse.json({ ok: false, error: `Estimator suite requires at least 40 valid measured samples; parsed ${samples.length}.` }, { status: 400 });
    }
    const model = trainEstimatorSuite(samples, {
      trees: num(body, "trees", 160),
      maxDepth: num(body, "maxDepth", num(body, "max-depth", 10)),
      minLeaf: num(body, "minLeaf", num(body, "min-leaf", 4)),
      hiddenUnits: num(body, "hiddenUnits", num(body, "hidden", 64)),
      epochs: num(body, "epochs", 900),
      learningRate: num(body, "learningRate", num(body, "learning-rate", 0.01)),
      l2: num(body, "l2", 0.0001),
      seed: num(body, "seed", 42),
      validationFraction: num(body, "validationFraction", num(body, "validation", 0.2)),
      maxSplitTrainSamples: num(body, "maxSplitTrainSamples", num(body, "max-split-train", 12000)),
      maxFinalTrainSamples: num(body, "maxFinalTrainSamples", num(body, "max-final-train", 20000)),
      splitKinds: normalizeSuiteSplitKinds(body.options?.splits ?? body.splits),
    });
    const bundle = buildEstimatorSuiteArtifacts(model, samples);
    const { dir, artifacts } = await writeRunArtifacts(runId, {
      "estimator-suite-model.json": bundle.modelJson,
      "suite-tree-residual-model.json": bundle.treeModelJson,
      "suite-neural-residual-model.json": bundle.neuralModelJson,
      "estimator-suite-validation.csv": bundle.validationCsv,
      "estimator-suite-predictions.csv": bundle.predictionsCsv,
      "estimator-suite-report.md": bundle.reportMarkdown,
    });
    return NextResponse.json({ ok: true, action, runId, dir, artifacts, model, reportMarkdown: bundle.reportMarkdown, validationCsv: bundle.validationCsv, predictionsCsv: bundle.predictionsCsv });
  } catch (error) {
    return NextResponse.json({ ok: false, error: formatZodError(error) }, { status: 400 });
  }
}
