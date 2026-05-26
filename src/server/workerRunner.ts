import type { JobRecord } from "@/types/job";
import {
  applyEstimatorSuiteToSearchResponse,
  type SearchResponseWithEstimatorSuite,
} from "@/lib/estimatorSuiteApply";
import { estimateMaybeThreaded } from "./threadedEstimate";
import {
  acquireJobLock,
  addLog,
  markStageDone,
  releaseJobLock,
  saveJob,
  updateJobStatus,
  updateProgress,
} from "./jobStore";
import { detectExternalToolVersion } from "./externalCommand";
import { normalizeError } from "@/lib/errors";
import { nowIso } from "@/lib/determinism";
import { jobDir } from "./workspace";
import { hasStageMarker, writeStageMarker } from "./atomic";
import { verifyRequiredArtifacts } from "./artifactIntegrity";
import {
  readEstimateCache,
  writeEstimateCache,
  cacheKey as estimateCacheKey,
} from "@/lib/cache";
import { readActiveEstimatorSuiteModel } from "./activeEstimatorSuite";

import type { ExternalRunSummary } from "./externalRunTypes";
import { appendExternalReport } from "./externalReport";
import {
  readExternalSummary,
  refreshIntegrityManifest,
  runIreeForJob,
  runScaleSimForJob,
} from "./externalJobRunners";
import { runEstimatorSuiteTrainingJob } from "./estimatorSuiteTrainingRunner";
import { throwIfCancelled, withTimeout } from "./jobExecutionGuards";
import { writeArtifacts, writePurposeGateArtifacts } from "./jobArtifactWriter";

export async function runJob(
  job: JobRecord,
  options: { lockHeld?: boolean } = {},
) {
  let lockHeld = Boolean(options.lockHeld);
  if (!lockHeld) {
    lockHeld = await acquireJobLock(job);
    if (!lockHeld) {
      await addLog(job, "건너뜀: 다른 worker가 이미 이 job을 잠갔습니다");
      return;
    }
  }
  job.startedAt = job.startedAt ?? nowIso();
  job.attempts = (job.attempts ?? 0) + 1;
  await saveJob(job);
  try {
    await runJobOnce(job);
  } catch (e: any) {
    if (
      String(e?.message ?? e)
        .toLowerCase()
        .includes("cancelled")
    ) {
      await updateJobStatus(job, "cancelled", "Job 취소됨");
    } else if ((job.attempts ?? 1) < (job.maxAttempts ?? 1)) {
      const err = normalizeError(e);
      job.status = "queued";
      job.stage = "retrying";
      job.progress = 0;
      job.error = JSON.stringify(err.toJSON?.() ?? err, null, 2);
      await updateProgress(
        job,
        "retrying",
        0,
        `시도 ${job.attempts} 실패; 재시도: ${e?.message ?? e}`,
      );
    } else {
      const err = normalizeError(e);
      job.error = JSON.stringify(
        err.toJSON?.() ?? { message: String(e) },
        null,
        2,
      );
      await updateJobStatus(job, "failed", `실패: ${err.message}`);
    }
  } finally {
    if (lockHeld) await releaseJobLock(job);
  }
}

async function runJobOnce(job: JobRecord) {
  await updateJobStatus(
    job,
    "running",
    `${job.kind} job 시작: ${job.attempts ?? 1}번째 시도`,
  );
  await updateProgress(
    job,
    "validated",
    5,
    "요청을 검증하고 상태 machine을 초기화했습니다",
  );
  await throwIfCancelled(job);

  if (job.kind === "estimator-suite-train") {
    await runEstimatorSuiteTrainingJob(job);
    return;
  }

  const versions = {
    scalesim: await detectExternalToolVersion(
      process.env.TILEFORGE_SCALE_SIM_CMD,
    ),
    iree: await detectExternalToolVersion(
      process.env.TILEFORGE_IREE_COMPILE_CMD,
    ),
  };
  if (versions.scalesim)
    await addLog(job, `SCALE-Sim 버전: ${versions.scalesim}`);
  if (versions.iree) await addLog(job, `IREE 버전: ${versions.iree}`);

  let res: SearchResponseWithEstimatorSuite | undefined;
  const dir = jobDir(job.id);
  if (!(await hasStageMarker(dir, "estimate"))) {
    await updateProgress(job, "estimating", 15, "Estimator 실행 중");
    const cached = await readEstimateCache(job.request);
    if (cached) {
      res = cached;
      await addLog(
        job,
        `Estimator cache hit: ${estimateCacheKey(job.request)}`,
      );
    } else {
      res = await estimateMaybeThreaded(job.request);
      await writeEstimateCache(job.request, res);
      await addLog(
        job,
        `Estimator cache 저장: ${estimateCacheKey(job.request)}`,
      );
    }
    const activeModel = await readActiveEstimatorSuiteModel();
    res = applyEstimatorSuiteToSearchResponse(res, activeModel);
    if (res.estimatorSuite?.applied)
      await addLog(
        job,
        `활성 Estimator Suite 적용: analytical=${res.estimatorSuite.totalAnalyticalCycles.toLocaleString()} → learned=${res.estimatorSuite.totalLearnedCycles.toLocaleString()} cycles`,
      );
    await writeStageMarker(dir, "estimate", {
      totalCycles: res.summary.totalCycles,
      cacheKey: estimateCacheKey(job.request),
      estimatorSuite: res.estimatorSuite,
    });
    await markStageDone(job, "estimating", "Estimator 완료");
  } else {
    await updateProgress(
      job,
      "estimating",
      35,
      "완료된 estimator 단계를 재사용합니다",
    );
    res =
      (await readEstimateCache(job.request)) ??
      (await estimateMaybeThreaded(job.request));
    const activeModel = await readActiveEstimatorSuiteModel();
    res = applyEstimatorSuiteToSearchResponse(res, activeModel);
    if (res.estimatorSuite?.applied)
      await addLog(
        job,
        `활성 Estimator Suite 적용: analytical=${res.estimatorSuite.totalAnalyticalCycles.toLocaleString()} → learned=${res.estimatorSuite.totalLearnedCycles.toLocaleString()} cycles`,
      );
  }

  await updateProgress(
    job,
    "generating-artifacts",
    45,
    "산출물을 atomic 방식으로 생성 중",
  );
  await writeArtifacts(job, res, versions);
  await writeStageMarker(dir, "artifacts", { count: job.artifacts.length });
  await throwIfCancelled(job);

  let scaleSummary: ExternalRunSummary | undefined;
  let ireeSummary: ExternalRunSummary | undefined;

  if (job.kind === "scalesim" || job.kind === "full-pipeline") {
    if (!(await hasStageMarker(dir, "scalesim"))) {
      await updateProgress(
        job,
        "running-scalesim",
        65,
        "SCALE-Sim 실제 실행 중",
      );
      scaleSummary = await withTimeout(job, "SCALE-Sim", () =>
        runScaleSimForJob(job, res),
      );
      await writeStageMarker(dir, "scalesim", scaleSummary);
    } else {
      await addLog(job, "완료된 SCALE-Sim 단계를 재사용합니다");
      scaleSummary = await readExternalSummary(dir, "scalesim_summary.json");
    }
  }
  await throwIfCancelled(job);

  if (job.kind === "iree-compile" || job.kind === "full-pipeline") {
    if (!(await hasStageMarker(dir, "iree"))) {
      await updateProgress(
        job,
        "running-iree",
        82,
        "IREE 실제 compile 실행 중",
      );
      ireeSummary = await withTimeout(job, "IREE compile", () =>
        runIreeForJob(job),
      );
      await writeStageMarker(dir, "iree", ireeSummary);
    } else {
      await addLog(job, "완료된 IREE 단계를 재사용합니다");
      ireeSummary = await readExternalSummary(dir, "iree_summary.json");
    }
  }
  await updateProgress(
    job,
    "generating-report",
    95,
    "SCALE-Sim/IREE 결과를 보고서에 반영 중",
  );
  await appendExternalReport(job, res, scaleSummary, ireeSummary);
  await writePurposeGateArtifacts(job, res, scaleSummary, ireeSummary);
  await refreshIntegrityManifest(job);
  await writeStageMarker(dir, "report");
  await updateProgress(job, "done", 100, "완료");
  const required = await verifyRequiredArtifacts(job.id);
  if (!required.ok) {
    const detail = `산출물 무결성 검사 실패. 누락=${required.missing.join(",") || "없음"}; 실패=${required.integrityFailures.map((f) => `${f.name}:${f.reason}`).join(";") || "없음"}`;
    job.error = detail;
    await updateJobStatus(job, "failed", detail);
    return;
  }
  const warnings = job.warnings ?? [];
  await updateJobStatus(
    job,
    warnings.length ? "succeeded_with_warnings" : "succeeded",
    warnings.length ? `Job 완료: 경고 ${warnings.length}개` : "Job 완료",
  );
}
