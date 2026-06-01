import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { stableId } from "@/lib/determinism";
import { buildEstimatorSuiteArtifacts, designEstimatorSuiteCsv, normalizeSuiteSplitKinds, parseEstimatorSamplesCsv } from "@/lib/estimatorSuiteArtifacts";
import { buildEstimatorDataset, estimatorDatasetSummaryMarkdown } from "@/lib/estimatorSuiteDataset";
import { buildEstimatorSamplingPlan, requestFromPlanRow } from "@/lib/estimatorSamplingPlan";
import { collectEstimatorSamplesFromJobs, mergeCollectedSamplesIntoCsv } from "@/lib/estimatorSuiteJobSamples";
import { createJob, createJobsBulk, listJobs, saveJob } from "@/server/jobStore";
import { trainEstimatorSuite } from "@/lib/estimatorSuite";
import { buildScopedEstimatorDatasets, buildScopedEstimatorPipeline } from "@/lib/estimatorSuitePipelines";
import { activateEstimatorSuiteModel, clearActiveEstimatorSuiteModel, listEstimatorSuiteModels, readActiveEstimatorSuiteModel } from "@/server/activeEstimatorSuite";
import { formatZodError, parseSearchRequest } from "@/lib/validation";
import { getJobRoot, getWorkspaceRoot, jobDir } from "@/server/workspace";

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



    if (action === "suite-job" || action === "dataset-job" || action === "dataset-and-train") {
      const request = parseSearchRequest(body.request);
      const isDatasetJob = action === "dataset-job" || action === "dataset-and-train";
      const job = await createJob("estimator-suite-train", request, body.name ?? (isDatasetJob ? "estimator_dataset_train" : "estimator_suite_train"));
      if (isDatasetJob) {
        const rawFiles = Array.isArray(body.files) ? body.files : [];
        const uploadDir = path.join(jobDir(job.id), "estimator-suite-upload");
        await mkdir(uploadDir, { recursive: true });
        const filePaths: Array<{ name: string; path: string }> = [];
        for (let i = 0; i < rawFiles.length; i++) {
          const name = String(rawFiles[i]?.name ?? `dataset_${i}.csv`).replace(/[\\/\0]/g, "_");
          const text = String(rawFiles[i]?.text ?? "");
          if (!text.trim()) continue;
          const rel = path.join("estimator-suite-upload", `${String(i).padStart(4, "0")}_${name}`);
          const abs = path.join(jobDir(job.id), rel);
          await writeFile(abs, text, "utf8");
          filePaths.push({ name, path: rel });
        }
        job.estimatorSuite = { mode: "dataset", filePaths, options: body.options ?? {}, dedupe: body.dedupe !== false, activate: body.activate !== false };
      } else {
        const csvText = String(body.csvText ?? body.csv ?? "");
        const rel = "estimator-suite-input.csv";
        await writeFile(path.join(jobDir(job.id), rel), csvText, "utf8");
        job.estimatorSuite = { mode: "csv", csvPath: rel, options: body.options ?? {}, activate: body.activate !== false };
        job.artifacts = [...new Set([...(job.artifacts ?? []), rel])];
      }
      await saveJob(job);
      return NextResponse.json({ ok: true, action, job, runId: job.id, message: "Estimator Suite 학습 job을 큐에 등록했습니다." });
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

    if (action === "dataset") {
      const rawFiles = Array.isArray(body.files) ? body.files : [];
      const files = rawFiles
        .map((f: any, index: number) => ({ name: String(f?.name ?? `dataset_${index}.csv`), text: String(f?.text ?? "") }))
        .filter((f: { name: string; text: string }) => f.text.trim().length > 0);
      if (!files.length) return NextResponse.json({ ok: false, error: "CSV files are required for dataset import." }, { status: 400 });
      const dataset = buildEstimatorDataset(files, { dedupe: body.dedupe !== false });
      const summaryMarkdown = estimatorDatasetSummaryMarkdown(dataset.summary);
      const { dir, artifacts } = await writeRunArtifacts(runId, {
        "estimator-suite-dataset.csv": dataset.csv,
        "estimator-suite-dataset-summary.md": summaryMarkdown,
      });
      const maxInlineBytes = Math.max(0, num(body, "maxInlineBytes", 512 * 1024));
      const includeCsv = dataset.csv.length <= maxInlineBytes;
      return NextResponse.json({
        ok: true,
        action,
        runId,
        dir,
        artifacts,
        csv: includeCsv ? dataset.csv : undefined,
        csvPreview: includeCsv ? undefined : dataset.csv.slice(0, 20000),
        csvOmitted: !includeCsv,
        summary: dataset.summary,
        reportMarkdown: summaryMarkdown,
      });
    }


    if (action === "split-dataset" || action === "scope-pipeline" || action === "split-and-train") {
      const rawFiles = Array.isArray(body.files) ? body.files : [];
      const fromCsv = String(body.csvText ?? body.csv ?? "");
      const files = [
        ...rawFiles.map((f: any, index: number) => ({ name: String(f?.name ?? `dataset_${index}.csv`), text: String(f?.text ?? "") })),
        ...(fromCsv.trim() ? [{ name: "input.csv", text: fromCsv }] : []),
      ].filter((f: { name: string; text: string }) => f.text.trim().length > 0);
      if (!files.length) return NextResponse.json({ ok: false, error: "CSV files are required for scoped estimator pipeline." }, { status: 400 });

      if (action === "split-dataset") {
        const scoped = buildScopedEstimatorDatasets(files, { dedupe: body.dedupe !== false });
        const { dir, artifacts } = await writeRunArtifacts(runId, {
          "datasets/merged/samples.csv": scoped.mergedCsv,
          "datasets/merged/report.md": scoped.mergedReportMarkdown,
          "datasets/full-layer/samples.csv": scoped.scopes["full-layer"].csv,
          "datasets/full-layer/report.md": scoped.scopes["full-layer"].reportMarkdown,
          "datasets/tile-policy/samples.csv": scoped.scopes["tile-policy"].csv,
          "datasets/tile-policy/report.md": scoped.scopes["tile-policy"].reportMarkdown,
        });
        return NextResponse.json({ ok: true, action, runId, dir, artifacts, summary: scoped.mergedSummary, scopes: Object.fromEntries(Object.entries(scoped.scopes).map(([k, v]) => [k, v.summary])), reportMarkdown: scoped.mergedReportMarkdown });
      }

      const pipeline = buildScopedEstimatorPipeline(files, {
        dedupe: body.dedupe !== false,
        minSamplesPerScope: num(body, "minSamplesPerScope", num(body, "min-samples-per-scope", 40)),
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
      const { dir, artifacts } = await writeRunArtifacts(runId, pipeline.files);
      return NextResponse.json({ ok: true, action, runId, dir, artifacts, summary: pipeline.mergedSummary, scopes: Object.fromEntries(Object.entries(pipeline.scopes).map(([k, v]) => [k, v.summary])), training: Object.fromEntries(Object.entries(pipeline.training).map(([k, v]) => [k, { status: v.status, samples: v.samples, reason: v.reason, model: v.model }])), reportMarkdown: pipeline.combinedReportMarkdown });
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
    const bundle = buildEstimatorSuiteArtifacts(model, samples, {
      maxPredictionRows: num(body, "maxPredictionRows", num(body, "max-prediction-rows", Number(process.env.TILEFORGE_MAX_PREDICTION_ARTIFACT_ROWS ?? 20000))),
    });
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
