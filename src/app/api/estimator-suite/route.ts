import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { stableId } from "@/lib/determinism";
import { buildEstimatorSuiteArtifacts, designEstimatorSuiteCsv, normalizeSuiteSplitKinds, parseEstimatorSamplesCsv } from "@/lib/estimatorSuiteArtifacts";
import { buildEstimatorDataset, estimatorDatasetSummaryMarkdown } from "@/lib/estimatorSuiteDataset";
import { buildEstimatorSamplingPlan, requestFromPlanRow } from "@/lib/estimatorSamplingPlan";
import { collectEstimatorSamplesFromJobs, mergeCollectedSamplesIntoCsv } from "@/lib/estimatorSuiteJobSamples";
import { createJobsBulk, listJobs } from "@/server/jobStore";
import { trainEstimatorSuite } from "@/lib/estimatorSuite";
import { activateEstimatorSuiteModel, clearActiveEstimatorSuiteModel, listEstimatorSuiteModels, readActiveEstimatorSuiteModel } from "@/server/activeEstimatorSuite";
import { formatZodError, parseSearchRequest } from "@/lib/validation";
import { getJobRoot, getWorkspaceRoot } from "@/server/workspace";

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

export async function GET() {
  try {
    const payload = await listEstimatorSuiteModels();
    const activeModel = await readActiveEstimatorSuiteModel();
    return NextResponse.json({ ok: true, ...payload, activeModel });
  } catch (error) {
    return NextResponse.json({ ok: false, error: formatZodError(error) }, { status: 400 });
  }
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

    if (action === "plan" || action === "plan-and-queue") {
      const request = parseSearchRequest(body.request);
      const maxSamples = num(body, "maxSamples", num(body, "max-samples", 512));
      const plan = buildEstimatorSamplingPlan(request, { ...(body.options ?? {}), maxSamples });
      const queuedJobs: Array<{ id: string; name?: string; status?: string }> = [];
      if (action === "plan-and-queue" || body.enqueue === true) {
        const queueLimit = Math.max(1, Math.min(num(body, "queueLimit", num(body, "queue-limit", maxSamples)), 50000));
        const rowsToQueue = plan.rows.slice(0, queueLimit);
        const jobs = await createJobsBulk(rowsToQueue.map(row => ({ kind: "full-pipeline" as const, request: requestFromPlanRow(request, row), name: row.scaleSimRunName })));
        for (const job of jobs) queuedJobs.push({ id: job.id, name: job.name, status: job.status });
      }
      const { dir, artifacts } = await writeRunArtifacts(runId, { "estimator-suite-sampling-plan.csv": plan.csv });
      return NextResponse.json({ ok: true, action, runId, dir, artifacts, planCsv: plan.csv, rows: plan.totalRows, queuedJobs });
    }


    if (action === "activate") {
      const runIdToActivate = String(body.runId ?? "").trim();
      if (!runIdToActivate) return NextResponse.json({ ok: false, error: "runId is required to activate estimator suite model." }, { status: 400 });
      const activated = await activateEstimatorSuiteModel(runIdToActivate);
      return NextResponse.json({ ok: true, action, activeRunId: activated.runId, activePath: activated.path, model: activated.model });
    }

    if (action === "clear-active") {
      await clearActiveEstimatorSuiteModel();
      return NextResponse.json({ ok: true, action });
    }

    if (action === "collect-jobs") {
      const csvText = String(body.csvText ?? body.csv ?? "");
      const jobs = await listJobs();
      const collected = await collectEstimatorSamplesFromJobs(jobs, getJobRoot());
      const mergedCsv = mergeCollectedSamplesIntoCsv(csvText, collected.rows);
      const validSamples = parseEstimatorSamplesCsv(mergedCsv).length;
      const { dir, artifacts } = await writeRunArtifacts(runId, { "estimator-suite-measured-samples.csv": mergedCsv });
      return NextResponse.json({
        ok: true,
        action,
        runId,
        dir,
        artifacts,
        csv: mergedCsv,
        rows: collected.rows.length,
        validSamples,
        skipped: collected.skipped.slice(0, 50),
      });
    }

    if (action === "dataset" || action === "dataset-and-train") {
      const rawFiles = Array.isArray(body.files) ? body.files : [];
      const files = rawFiles
        .map((f: any, index: number) => ({ name: String(f?.name ?? `dataset_${index}.csv`), text: String(f?.text ?? "") }))
        .filter((f: { name: string; text: string }) => f.text.trim().length > 0);
      if (!files.length) return NextResponse.json({ ok: false, error: "CSV files are required for dataset import." }, { status: 400 });
      const dataset = buildEstimatorDataset(files, { dedupe: body.dedupe !== false });
      const summaryMarkdown = estimatorDatasetSummaryMarkdown(dataset.summary);
      const filesToWrite: Record<string, string> = {
        "estimator-suite-dataset.csv": dataset.csv,
        "estimator-suite-dataset-summary.md": summaryMarkdown,
      };
      let model = null as ReturnType<typeof trainEstimatorSuite> | null;
      let bundle = null as ReturnType<typeof buildEstimatorSuiteArtifacts> | null;
      if (action === "dataset-and-train" || body.train === true) {
        if (dataset.samples.length < 40) {
          return NextResponse.json({ ok: false, error: `Estimator suite requires at least 40 valid measured samples; parsed ${dataset.samples.length}.`, summary: dataset.summary, csv: dataset.csv, reportMarkdown: summaryMarkdown }, { status: 400 });
        }
        model = trainEstimatorSuite(dataset.samples, {
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
        bundle = buildEstimatorSuiteArtifacts(model, dataset.samples);
        Object.assign(filesToWrite, {
          "estimator-suite-model.json": bundle.modelJson,
          "suite-tree-residual-model.json": bundle.treeModelJson,
          "suite-neural-residual-model.json": bundle.neuralModelJson,
          "estimator-suite-validation.csv": bundle.validationCsv,
          "estimator-suite-predictions.csv": bundle.predictionsCsv,
          "estimator-suite-report.md": bundle.reportMarkdown,
        });
      }
      const { dir, artifacts } = await writeRunArtifacts(runId, filesToWrite);
      return NextResponse.json({
        ok: true,
        action,
        runId,
        dir,
        artifacts,
        csv: dataset.csv,
        summary: dataset.summary,
        reportMarkdown: bundle?.reportMarkdown ?? summaryMarkdown,
        validationCsv: bundle?.validationCsv,
        predictionsCsv: bundle?.predictionsCsv,
        model,
      });
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
