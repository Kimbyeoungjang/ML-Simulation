import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { JobRecord } from "@/types/job";
import { trainEstimatorSuite } from "@/lib/estimatorSuite";
import {
  buildEstimatorSuiteArtifacts,
  normalizeSuiteSplitKinds,
  parseEstimatorSamplesCsv,
} from "@/lib/estimatorSuiteArtifacts";
import {
  buildEstimatorDataset,
  estimatorDatasetSummaryMarkdown,
} from "@/lib/estimatorSuiteDataset";
import {
  applyEstimatorSuiteTrainingPolicy,
  estimatorSuiteTrainingPolicyJson,
  estimatorSuiteTrainingPolicyMarkdown,
  normalizeEstimatorSuiteTrainingTargetScope,
} from "@/lib/estimatorSuiteTrainingPolicy";
import { activateEstimatorSuiteModel } from "./activeEstimatorSuite";
import {
  addLogImmediate,
  listJobs,
  saveJob,
  updateJobStatus,
  updateProgressImmediate,
} from "./jobStore";
import { getJobRoot, getWorkspaceRoot, jobDir } from "./workspace";
import { throwIfCancelled } from "./jobExecutionGuards";
import { resolveInsideRoot } from "./pathSafety";
import { collectEstimatorSamplesFromJobs, mergeCollectedSamplesIntoCsv } from "@/lib/estimatorSuiteJobSamples";

function suiteNum(payload: any, name: string, fallback: number) {
  const v = Number(payload?.options?.[name] ?? payload?.[name]);
  return Number.isFinite(v) ? v : fallback;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalStatus(status: string | undefined) {
  return status === "succeeded" ||
    status === "succeeded_with_warnings" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "skipped_external_tool";
}

async function waitForAutoCollectJobs(job: JobRecord, jobIds: string[], maxWaitMs: number) {
  const uniqueIds = [...new Set(jobIds.filter(Boolean))];
  if (!uniqueIds.length) return await listJobs();
  const deadline = Date.now() + Math.max(60_000, maxWaitMs);
  const wanted = new Set(uniqueIds);
  while (true) {
    const jobs = await listJobs();
    const selected = jobs.filter((candidate) => wanted.has(candidate.id));
    const done = selected.filter((candidate) => isTerminalStatus(candidate.status)).length;
    const failed = selected.filter((candidate) => candidate.status === "failed" || candidate.status === "cancelled" || candidate.status === "skipped_external_tool").length;
    updateProgressImmediate(
      job,
      "preparing-dataset",
      Math.min(32, 8 + Math.round((done / Math.max(1, uniqueIds.length)) * 20)),
      `추천 검증 job 완료 대기 중: ${done}/${uniqueIds.length}${failed ? `, 실패/취소 ${failed}` : ""}`,
    );
    await throwIfCancelled(job);
    if (done >= uniqueIds.length) return jobs;
    if (Date.now() > deadline) {
      const pending = uniqueIds.filter((id) => {
        const found = selected.find((candidate) => candidate.id === id);
        return !found || !isTerminalStatus(found.status);
      });
      throw new Error(`Active-learning validation jobs did not finish within ${Math.round(maxWaitMs / 1000)}s: ${pending.join(", ")}`);
    }
    await sleep(2000);
  }
}

async function readDatasetFileFromJobDir(
  localDir: string,
  file: any,
  index: number,
) {
  const rel = String(file?.path ?? "");
  const abs = resolveInsideRoot(localDir, rel);
  if (!abs)
    return {
      name: String(file?.name ?? `dataset_${index}.csv`),
      text: "",
    };
  return {
    name: String(file?.name ?? `dataset_${index}.csv`),
    text: await readFile(abs, "utf8"),
  };
}

export async function runEstimatorSuiteTrainingJob(job: JobRecord) {
  const payload = job.estimatorSuite ?? {};
  const suiteRoot = path.join(getWorkspaceRoot(), "estimator-suite");
  const runDir = path.join(suiteRoot, job.id);
  const localDir = jobDir(job.id);
  await mkdir(runDir, { recursive: true });

  updateProgressImmediate(
    job,
    "preparing-dataset",
    8,
    "Estimator Suite 학습 dataset 준비 중",
  );
  await throwIfCancelled(job);

  let csvText = String(payload.csvText ?? "");
  if (!csvText && payload.csvPath) {
    const csvAbs = resolveInsideRoot(localDir, String(payload.csvPath));
    if (csvAbs) csvText = await readFile(csvAbs, "utf8");
  }

  const autoCollect = payload.autoCollect ?? {};
  if (Array.isArray(autoCollect.jobIds) && autoCollect.jobIds.length) {
    addLogImmediate(
      job,
      `Active learning: 추천 검증 job ${autoCollect.jobIds.length}개의 완료를 기다린 뒤 학습 데이터로 수집합니다.`,
    );
    const allJobs = await waitForAutoCollectJobs(
      job,
      autoCollect.jobIds,
      Number(autoCollect.maxWaitMs ?? 60 * 60 * 1000),
    );
    const collectIds = new Set(String(autoCollect.includeExistingCompletedJobs) === "false" ? autoCollect.jobIds : allJobs.map((candidate) => candidate.id));
    const jobsToCollect = allJobs.filter((candidate) => collectIds.has(candidate.id));
    const collected = await collectEstimatorSamplesFromJobs(jobsToCollect, getJobRoot());
    csvText = mergeCollectedSamplesIntoCsv(csvText, collected.rows);
    addLogImmediate(
      job,
      `Active learning: 수집 row=${collected.rows.length}, skipped=${collected.skipped.length}, includeExisting=${autoCollect.includeExistingCompletedJobs !== false}`,
    );
    await writeFile(
      path.join(runDir, "active-learning-collected-samples.csv"),
      csvText,
      "utf8",
    );
    await writeFile(
      path.join(runDir, "active-learning-collection-report.json"),
      JSON.stringify({
        collectedRows: collected.rows.length,
        skipped: collected.skipped.slice(0, 200),
        jobIds: autoCollect.jobIds,
        includeExistingCompletedJobs: autoCollect.includeExistingCompletedJobs !== false,
      }, null, 2),
      "utf8",
    );
    await writeFile(
      path.join(localDir, "active-learning-collected-samples.csv"),
      csvText,
      "utf8",
    );
    await writeFile(
      path.join(localDir, "active-learning-collection-report.json"),
      JSON.stringify({
        collectedRows: collected.rows.length,
        skipped: collected.skipped.slice(0, 200),
        jobIds: autoCollect.jobIds,
        includeExistingCompletedJobs: autoCollect.includeExistingCompletedJobs !== false,
      }, null, 2),
      "utf8",
    );
    job.artifacts = [
      ...new Set([
        ...(job.artifacts ?? []),
        "active-learning-collected-samples.csv",
        "active-learning-collection-report.json",
      ]),
    ];
    await saveJob(job);
  }

  let samples = parseEstimatorSamplesCsv(csvText);
  let datasetSummaryMarkdown = "";
  if (
    payload.mode === "dataset" ||
    Array.isArray(payload.files) ||
    Array.isArray(payload.filePaths)
  ) {
    const rawFiles = Array.isArray(payload.files) ? payload.files : [];
    const pathFiles = Array.isArray(payload.filePaths)
      ? await Promise.all(
          payload.filePaths.map((f: any, index: number) =>
            readDatasetFileFromJobDir(localDir, f, index),
          ),
        )
      : [];
    const files = [...rawFiles, ...pathFiles]
      .map((f: any, index: number) => ({
        name: String(f?.name ?? `dataset_${index}.csv`),
        text: String(f?.text ?? ""),
      }))
      .filter((f: { name: string; text: string }) => f.text.trim().length > 0);
    const dataset = buildEstimatorDataset(files, {
      dedupe: payload.dedupe !== false,
    });
    csvText = dataset.csv;
    samples = dataset.samples;
    datasetSummaryMarkdown = estimatorDatasetSummaryMarkdown(dataset.summary);
    addLogImmediate(
      job,
      `Dataset Manager: files=${files.length}, inputRows=${dataset.summary.inputRows}, validSamples=${dataset.summary.validSamples}, duplicates=${dataset.summary.duplicatesRemoved}`,
    );
    await writeFile(
      path.join(runDir, "estimator-suite-dataset.csv"),
      dataset.csv,
      "utf8",
    );
    await writeFile(
      path.join(runDir, "estimator-suite-dataset-summary.md"),
      datasetSummaryMarkdown,
      "utf8",
    );
    await writeFile(
      path.join(localDir, "estimator-suite-dataset.csv"),
      dataset.csv,
      "utf8",
    );
    await writeFile(
      path.join(localDir, "estimator-suite-dataset-summary.md"),
      datasetSummaryMarkdown,
      "utf8",
    );
    job.artifacts = [
      ...new Set([
        ...(job.artifacts ?? []),
        "estimator-suite-dataset.csv",
        "estimator-suite-dataset-summary.md",
      ]),
    ];
  } else {
    await writeFile(
      path.join(runDir, "estimator-suite-input.csv"),
      csvText,
      "utf8",
    );
    if (!payload.csvPath)
      await writeFile(
        path.join(localDir, "estimator-suite-input.csv"),
        csvText,
        "utf8",
      );
    job.artifacts = [
      ...new Set([...(job.artifacts ?? []), "estimator-suite-input.csv"]),
    ];
  }
  await saveJob(job);

  const targetScope = normalizeEstimatorSuiteTrainingTargetScope(
    (payload.options as any)?.targetScope ?? (payload as any).targetScope ?? "auto",
  );
  const trainingPolicy = applyEstimatorSuiteTrainingPolicy(samples, { targetScope });
  samples = trainingPolicy.samples;
  await writeFile(
    path.join(runDir, "estimator-suite-training-policy.json"),
    estimatorSuiteTrainingPolicyJson(trainingPolicy),
    "utf8",
  );
  await writeFile(
    path.join(runDir, "estimator-suite-training-policy.md"),
    estimatorSuiteTrainingPolicyMarkdown(trainingPolicy),
    "utf8",
  );
  await writeFile(
    path.join(localDir, "estimator-suite-training-policy.json"),
    estimatorSuiteTrainingPolicyJson(trainingPolicy),
    "utf8",
  );
  await writeFile(
    path.join(localDir, "estimator-suite-training-policy.md"),
    estimatorSuiteTrainingPolicyMarkdown(trainingPolicy),
    "utf8",
  );
  job.artifacts = [
    ...new Set([
      ...(job.artifacts ?? []),
      "estimator-suite-training-policy.json",
      "estimator-suite-training-policy.md",
    ]),
  ];
  await saveJob(job);
  for (const warning of trainingPolicy.warnings) addLogImmediate(job, `Training policy: ${warning}`);

  if (samples.length < 40) {
    throw new Error(
      `Estimator suite requires at least 40 valid measured samples after scope policy; parsed ${samples.length} (input ${trainingPolicy.inputSamples}, requestedScope=${trainingPolicy.requestedScope}, effectiveScope=${trainingPolicy.effectiveScope}).`,
    );
  }

  addLogImmediate(
    job,
    `학습 sample ${samples.length.toLocaleString()}개 선택 완료(scope=${trainingPolicy.effectiveScope}, input=${trainingPolicy.inputSamples.toLocaleString()})`,
  );
  addLogImmediate(
    job,
    `설정: trees=${suiteNum(payload, "trees", 160)}, maxDepth=${suiteNum(payload, "maxDepth", suiteNum(payload, "max-depth", 10))}, hidden=${suiteNum(payload, "hiddenUnits", suiteNum(payload, "hidden", 64))}, epochs=${suiteNum(payload, "epochs", 900)}, maxFinalTrain=${suiteNum(payload, "maxFinalTrainSamples", suiteNum(payload, "max-final-train", 20000))}`,
  );
  await throwIfCancelled(job);

  const model = trainEstimatorSuite(samples, {
    trees: suiteNum(payload, "trees", 160),
    maxDepth: suiteNum(payload, "maxDepth", suiteNum(payload, "max-depth", 10)),
    minLeaf: suiteNum(payload, "minLeaf", suiteNum(payload, "min-leaf", 4)),
    hiddenUnits: suiteNum(
      payload,
      "hiddenUnits",
      suiteNum(payload, "hidden", 64),
    ),
    epochs: suiteNum(payload, "epochs", 900),
    learningRate: suiteNum(
      payload,
      "learningRate",
      suiteNum(payload, "learning-rate", 0.01),
    ),
    l2: suiteNum(payload, "l2", 0.0001),
    seed: suiteNum(payload, "seed", 42),
    validationFraction: suiteNum(
      payload,
      "validationFraction",
      suiteNum(payload, "validation", 0.2),
    ),
    maxSplitTrainSamples: suiteNum(
      payload,
      "maxSplitTrainSamples",
      suiteNum(payload, "max-split-train", 12000),
    ),
    maxFinalTrainSamples: suiteNum(
      payload,
      "maxFinalTrainSamples",
      suiteNum(payload, "max-final-train", 20000),
    ),
    splitKinds: normalizeSuiteSplitKinds(
      (payload.options as any)?.splits ?? (payload as any).splits,
    ),
    progress: (event) => {
      const stage =
        event.stage === "training-tree" ||
        event.stage === "training-neural" ||
        event.stage === "validating"
          ? event.stage
          : "validating";
      const progress = Math.max(
        10,
        Math.min(96, Math.round(Number(event.progress ?? job.progress ?? 10))),
      );
      updateProgressImmediate(job, stage as any, progress, event.message);
    },
  });

  updateProgressImmediate(job, "writing-artifacts", 97, "학습 산출물 생성 중");
  const bundle = buildEstimatorSuiteArtifacts(model, samples);
  const files: Record<string, string> = {
    "estimator-suite-model.json": bundle.modelJson,
    "suite-tree-residual-model.json": bundle.treeModelJson,
    "suite-neural-residual-model.json": bundle.neuralModelJson,
    "estimator-suite-validation.csv": bundle.validationCsv,
    "estimator-suite-predictions.csv": bundle.predictionsCsv,
    "estimator-suite-report.md": bundle.reportMarkdown,
  };
  for (const [name, text] of Object.entries(files)) {
    await writeFile(path.join(runDir, name), text, "utf8");
    await writeFile(path.join(localDir, name), text, "utf8");
  }
  job.artifacts = [
    ...new Set([...(job.artifacts ?? []), ...Object.keys(files)]),
  ];
  if (payload.activate !== false) {
    await activateEstimatorSuiteModel(job.id);
    addLogImmediate(job, `활성 Estimator Suite로 적용 완료: ${job.id}`);
  }
  await saveJob(job);
  updateProgressImmediate(
    job,
    "done",
    100,
    `Estimator Suite 학습 완료: samples=${model.metadata.samples}, train=${model.metadata.trainSamples}, recommended=${model.recommended}, blend=${model.blend?.mode ?? "linear-legacy"}, weights a=${model.weights.analytical.toFixed(3)}, tree=${model.weights.tree.toFixed(3)}, residual-neural=${model.weights.neural.toFixed(3)}, direct-neural=${(model.weights.directNeural ?? 0).toFixed(3)}`,
  );
  await updateJobStatus(job, "succeeded", "Estimator Suite 학습 job 완료");
}
