import path from "node:path";
import type { JobRecord } from "@/types/job";
import { estimateAll } from "@/lib/estimator";
import { responseToPolicyEntries } from "@/lib/policyDb";
import {
  RESULT_SCHEMA_VERSION,
  POLICY_DB_SCHEMA_VERSION,
  stampArtifact,
} from "@/lib/schemas";
import { assessConfidence, confidenceMarkdown } from "@/lib/confidence";
import { totalCycleUncertainty } from "@/lib/uncertainty";
import { evaluatePurposeGate, purposeGateMarkdown } from "@/lib/purposeGate";
import { artifactGuideJson, artifactGuideMarkdown } from "@/lib/artifactGuide";
import { buildPredictionRiskRegister, predictionRiskRegisterJson, predictionRiskRegisterMarkdown } from "@/lib/predictionRiskRegister";
import { buildValidationPlan, validationPlanJson, validationPlanMarkdown } from "@/lib/validationPlan";
import { buildValidationRunbook, validationRunbookJson, validationRunbookMarkdown } from "@/lib/validationRunbook";
import { fullLayerModelCardJson, fullLayerModelCardMarkdown } from "@/lib/fullLayerModelCard";
import { buildExternalEnvironmentReport, externalEnvironmentReportJson, externalEnvironmentReportMarkdown } from "./externalEnvironmentReport";
import { atomicWriteFile } from "./atomic";
import {
  computeArtifactIntegrity,
  computeJobIntegrityManifest,
} from "./artifactIntegrity";
import { recordArtifactSqlite } from "./sqliteStore";
import { addLog, saveJob } from "./jobStore";
import { jobDir } from "./workspace";
import type { ExternalRunSummary } from "./externalRunTypes";

type EstimateResponse = ReturnType<typeof estimateAll>;

export async function writePurposeGateArtifacts(
  job: JobRecord,
  res: EstimateResponse,
  scaleSummary?: ExternalRunSummary,
  ireeSummary?: ExternalRunSummary,
) {
  const dir = jobDir(job.id);
  const confidence = assessConfidence(res, {
    externalValidated: Boolean(scaleSummary?.ok || ireeSummary?.ok),
    externalCycleRatio: scaleSummary?.cycleRatio,
    estimatorSuiteSamples: (res as any).estimatorSuite?.applied
      ? ((res as any).estimatorSuite.modelSamples ?? 0)
      : 0,
  });
  const riskRegister = buildPredictionRiskRegister(res);
  const gate = evaluatePurposeGate(res, {
    confidence,
    scaleSim: scaleSummary,
    iree: ireeSummary,
    riskRegister,
  });
  const validationPlan = buildValidationPlan({
    response: res,
    riskRegister,
    gate,
    scaleSim: scaleSummary,
    iree: ireeSummary,
  });
  const validationRunbook = buildValidationRunbook({ plan: validationPlan, artifactDir: dir });
  await atomicWriteFile(
    path.join(dir, "purpose_gate.json"),
    JSON.stringify(gate, null, 2),
  );
  await atomicWriteFile(
    path.join(dir, "purpose_gate.md"),
    purposeGateMarkdown(gate),
  );
  await atomicWriteFile(
    path.join(dir, "prediction_risk_register.json"),
    predictionRiskRegisterJson(riskRegister),
  );
  await atomicWriteFile(
    path.join(dir, "prediction_risk_register.md"),
    predictionRiskRegisterMarkdown(riskRegister),
  );
  await atomicWriteFile(
    path.join(dir, "validation_plan.json"),
    validationPlanJson(validationPlan),
  );
  await atomicWriteFile(
    path.join(dir, "validation_plan.md"),
    validationPlanMarkdown(validationPlan),
  );
  await atomicWriteFile(
    path.join(dir, "validation_runbook.json"),
    validationRunbookJson(validationRunbook),
  );
  await atomicWriteFile(
    path.join(dir, "validation_runbook.md"),
    validationRunbookMarkdown(validationRunbook),
  );
  const guideNames = [
    ...(job.artifacts ?? []),
    "purpose_gate.json",
    "purpose_gate.md",
    "prediction_risk_register.json",
    "prediction_risk_register.md",
    "validation_plan.json",
    "validation_plan.md",
    "validation_runbook.json",
    "validation_runbook.md",
    "artifact_guide.json",
    "artifact_guide.md",
  ];
  await atomicWriteFile(
    path.join(dir, "artifact_guide.json"),
    artifactGuideJson({ artifacts: guideNames, res, gate, externalApplied: Boolean(scaleSummary?.ok || ireeSummary?.ok) }),
  );
  await atomicWriteFile(
    path.join(dir, "artifact_guide.md"),
    artifactGuideMarkdown({ artifacts: guideNames, res, gate, externalApplied: Boolean(scaleSummary?.ok || ireeSummary?.ok) }),
  );
  job.artifacts = [
    ...new Set([
      ...(job.artifacts ?? []),
      "purpose_gate.json",
      "purpose_gate.md",
      "prediction_risk_register.json",
      "prediction_risk_register.md",
      "validation_plan.json",
      "validation_plan.md",
      "validation_runbook.json",
      "validation_runbook.md",
      "artifact_guide.json",
      "artifact_guide.md",
    ]),
  ];
  await saveJob(job);
}

export async function writeArtifacts(
  job: JobRecord,
  res: EstimateResponse,
  versions?: { scalesim?: string; iree?: string },
) {
  const dir = jobDir(job.id);
  const resultJson = JSON.stringify(
    stampArtifact(RESULT_SCHEMA_VERSION, { response: res }),
    null,
    2,
  );
  const policyDbJson = JSON.stringify(
    stampArtifact(POLICY_DB_SCHEMA_VERSION, {
      entries: responseToPolicyEntries(res),
    }),
    null,
    2,
  );
  const confidence = assessConfidence(res, {
    externalValidated: Boolean(res.artifacts.validationCsv),
    estimatorSuiteSamples: (res as any).estimatorSuite?.applied
      ? ((res as any).estimatorSuite.modelSamples ?? 0)
      : 0,
  });
  const uncertainty = totalCycleUncertainty(res);
  const riskRegister = buildPredictionRiskRegister(res);
  const gate = evaluatePurposeGate(res, { confidence, riskRegister });
  const validationPlan = buildValidationPlan({ response: res, riskRegister, gate });
  const validationRunbook = buildValidationRunbook({ plan: validationPlan, artifactDir: dir });
  const externalEnv = buildExternalEnvironmentReport({ scalesimVersion: versions?.scalesim, ireeVersion: versions?.iree });
  const artifacts: Record<string, string> = {
    "best_tile_policy.csv": res.artifacts.policyCsv,
    "generated.mlir": res.artifacts.mlir,
    "transform.mlir": res.artifacts.transformDialect,
    "report.md": res.artifacts.reportMarkdown,
    "scalesim.cfg": res.artifacts.scaleSimConfig,
    "topology.csv": res.artifacts.scaleSimTopology,
    "layout.csv": res.artifacts.scaleSimLayout ?? "",
    "topology_top3.csv": res.artifacts.scaleSimTopkTopology ?? "",
    "layout_top3.csv": res.artifacts.scaleSimTopkLayout ?? "",
    "project.json": res.artifacts.projectJson,
    "manifest.json": res.artifacts.manifestJson ?? "{}",
    "iree-command.sh": res.artifacts.ireeCommand ?? "",
    "policy_table.tex": res.artifacts.latexTable ?? "",
    "summary.svg": res.artifacts.svgSummary ?? "",
    "experiment_comparison.csv": res.artifacts.experimentComparisonCsv ?? "",
    "validation_report.md": res.artifacts.validationMarkdown ?? "",
    "validation_report.csv": res.artifacts.validationCsv ?? "",
    "robust_policy.md": res.artifacts.robustPolicyMarkdown ?? "",
    "robust_policy.csv": res.artifacts.robustPolicyCsv ?? "",
    "dataflow_comparison.csv": res.artifacts.dataflowComparisonCsv ?? "",
    "memory_traffic.csv": res.artifacts.memoryTrafficCsv ?? "",
    "prune_report.txt": res.artifacts.pruneReportMarkdown ?? "",
    "tile_schedule.svg": res.artifacts.tileScheduleSvg ?? "",
    "compiler_hints.json": res.artifacts.compilerHintsJson ?? "{}",
    "compiler_hints.md": res.artifacts.compilerHintsMarkdown ?? "",
    "iree_benchmark_plan.json": res.artifacts.ireeBenchmarkPlanJson ?? "{}",
    "iree_benchmark_plan.md": res.artifacts.ireeBenchmarkPlanMarkdown ?? "",
    "hardware_design_plan.json": res.artifacts.hardwareDesignPlanJson ?? "{}",
    "hardware_design_plan.md": res.artifacts.hardwareDesignPlanMarkdown ?? "",
    "tiling_strategy.json": res.artifacts.tilingStrategyJson ?? "{}",
    "tiling_strategy.md": res.artifacts.tilingStrategyMarkdown ?? "",
    "prediction_contract.json": res.artifacts.predictionContractJson ?? "{}",
    "full_layer_model_card.json": fullLayerModelCardJson(res),
    "full_layer_model_card.md": fullLayerModelCardMarkdown(res),
    "prediction_risk_register.json": predictionRiskRegisterJson(riskRegister),
    "prediction_risk_register.md": predictionRiskRegisterMarkdown(riskRegister),
    "validation_plan.json": validationPlanJson(validationPlan),
    "validation_plan.md": validationPlanMarkdown(validationPlan),
    "validation_runbook.json": validationRunbookJson(validationRunbook),
    "validation_runbook.md": validationRunbookMarkdown(validationRunbook),
    "external_environment.json": externalEnvironmentReportJson(externalEnv),
    "external_environment.md": externalEnvironmentReportMarkdown(externalEnv),
    "confidence.md": confidenceMarkdown(confidence),
    "uncertainty.json": JSON.stringify(uncertainty, null, 2),
    "purpose_gate.json": JSON.stringify(gate, null, 2),
    "purpose_gate.md": purposeGateMarkdown(gate),
    "external_tools.json": JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scalesim: {
          configured: Boolean(process.env.TILEFORGE_SCALE_SIM_CMD),
          version: versions?.scalesim ?? null,
        },
        iree: {
          configured: Boolean(process.env.TILEFORGE_IREE_COMPILE_CMD),
          version: versions?.iree ?? null,
        },
      },
      null,
      2,
    ),
    "policy-db.json": policyDbJson,
    "result.json": resultJson,
  };
  const guideNames = [...Object.keys(artifacts), "artifact_guide.json", "artifact_guide.md"];
  artifacts["artifact_guide.json"] = artifactGuideJson({ artifacts: guideNames, res, gate });
  artifacts["artifact_guide.md"] = artifactGuideMarkdown({ artifacts: guideNames, res, gate });
  for (const [name, content] of Object.entries(artifacts))
    await atomicWriteFile(path.join(dir, name), content);
  const artifactNames = Object.keys(artifacts);
  const integrity = await computeJobIntegrityManifest(job.id, artifactNames);
  await atomicWriteFile(
    path.join(dir, "artifact_integrity.json"),
    JSON.stringify(integrity, null, 2),
  );
  for (const item of integrity.artifacts) recordArtifactSqlite(job.id, item);
  recordArtifactSqlite(
    job.id,
    await computeArtifactIntegrity(
      job.id,
      "artifact_integrity.json",
      "tileforge.integrity.v1",
    ),
  );
  job.artifacts = [
    ...new Set([
      ...(job.artifacts ?? []),
      ...artifactNames,
      "artifact_integrity.json",
    ]),
  ];
  await saveJob(job);
  await addLog(
    job,
    `${artifactNames.length}개 산출물을 atomic rename으로 저장하고 SHA-256 checksum을 기록했습니다`,
  );
}
