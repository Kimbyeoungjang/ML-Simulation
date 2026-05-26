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
  saveJob,
  updateJobStatus,
  updateProgressImmediate,
} from "./jobStore";
import { getWorkspaceRoot, jobDir } from "./workspace";
import { throwIfCancelled } from "./jobExecutionGuards";
import { resolveInsideRoot } from "./pathSafety";

function suiteNum(payload: any, name: string, fallback: number) {
  const v = Number(payload?.options?.[name] ?? payload?.[name]);
  return Number.isFinite(v) ? v : fallback;
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
