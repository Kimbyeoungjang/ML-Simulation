import type { SearchResponse } from "@/types/domain";

function fmt(n: unknown, digits = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return digits > 0 ? v.toFixed(digits) : Math.round(v).toLocaleString();
}

function pct(n: unknown, digits = 1) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

function topRows<T>(rows: T[], limit: number) {
  return rows.slice(0, Math.max(0, limit));
}

function collectIssues(res: SearchResponse) {
  const issues: string[] = [];
  const suite = (res as any).estimatorSuite;
  if (res.summary.meanUtilization < 0.5) {
    issues.push(`평균 PE 사용률이 낮습니다 (${pct(res.summary.meanUtilization)}). array 크기와 M/N/K 정렬 또는 dataflow를 비교하세요.`);
  }
  if (res.summary.meanPaddingRatio > 0.25) {
    issues.push(`평균 padding 비율이 큽니다 (${pct(res.summary.meanPaddingRatio)}). tile 후보 또는 workload shape 정렬을 확인하세요.`);
  }
  const sramLimit = Math.max(1, res.request.hardware.sramKB * 1024);
  const maxTileScratch = res.summary.maxTileScratchBytes ?? res.summary.maxSramBytes;
  if (maxTileScratch > sramLimit) {
    issues.push(`최대 tile scratch ${fmt(maxTileScratch / 1024, 1)} KiB가 설정 SRAM ${fmt(res.request.hardware.sramKB)} KiB를 초과합니다.`);
  }
  const maxLayerWorkingSet = res.summary.maxFullLayerSramBytes ?? maxTileScratch;
  if (maxLayerWorkingSet > sramLimit * 4) {
    issues.push(`최대 full-layer working set ${fmt(maxLayerWorkingSet / 1024, 1)} KiB가 SRAM보다 큽니다. 이는 타일 실패가 아니라 refill/spill 민감도 신호입니다.`);
  }
  const warnings = res.results.flatMap((r) => r.best.warnings ?? []);
  for (const warning of warnings.slice(0, 6)) issues.push(String(warning));
  if (warnings.length > 6) issues.push(`추가 warning ${warnings.length - 6}개가 생략되었습니다.`);
  if (suite?.applied && suite.minDomainConfidence !== undefined && suite.minDomainConfidence < 0.8) {
    issues.push(`Estimator Suite domain confidence가 낮은 후보가 있습니다(min=${suite.minDomainConfidence.toFixed(2)}). SCALE-Sim 검증 후보를 추가하는 것이 좋습니다.`);
  }
  if (Array.isArray(suite?.warnings)) {
    for (const warning of suite.warnings.slice(0, 4)) issues.push(String(warning));
  }
  return [...new Set(issues)];
}

export function generateReportMarkdown(res: SearchResponse): string {
  const h = res.request.hardware;
  const suite = (res as any).estimatorSuite;
  const issues = collectIssues(res);
  const representative = suite?.predictionTarget === "tile-policy"
    ? "Tile-policy cycle"
    : "Full-layer hardware-design cycle";

  const lines: string[] = [];
  lines.push(`# TileForge 분석 보고서 / 결과 요약`, "", `생성 시각: ${new Date().toISOString()}`, "");
  lines.push(`이 보고서는 **빠른 하드웨어 설계 탐색용 full-layer cycle**을 대표값으로 사용합니다. Tile-policy cycle은 **타일링 전략과 IREE lowering hint**를 고르기 위한 별도 보조 지표입니다. compile 성공은 runtime 성능 검증이 아니므로, 최종 옵션은 IREE benchmark로 확인해야 합니다.`, "");

  lines.push(`## 1. 핵심 결과`);
  lines.push(`| 항목 | 값 |`);
  lines.push(`|---|---:|`);
  lines.push(`| 대표 예측 목표 | ${representative} |`);
  lines.push(`| 전체 cycle | ${fmt(res.summary.totalCycles)} |`);
  lines.push(`| 예상 시간 | ${fmt(res.summary.totalTimeUs, 3)} us |`);
  lines.push(`| 평균 PE 사용률 | ${pct(res.summary.meanUtilization, 2)} |`);
  lines.push(`| 평균 padding | ${pct(res.summary.meanPaddingRatio, 2)} |`);
  lines.push(`| 최대 tile scratch | ${fmt((res.summary.maxTileScratchBytes ?? res.summary.maxSramBytes) / 1024, 1)} KiB |`);
  lines.push(`| 최대 full-layer working set | ${fmt((res.summary.maxFullLayerSramBytes ?? res.summary.maxSramBytes) / 1024, 1)} KiB |`);
  const minConfidence = Math.min(...res.results.map(r => r.best.predictionConfidence ?? 1));
  lines.push(`| 병목 op | ${res.summary.bottleneckOp || "-"} |`);
  lines.push(`| 최소 예측 confidence | ${(minConfidence * 100).toFixed(0)}% |`);
  if (res.energy?.totalEnergyUJ !== undefined) lines.push(`| 예상 에너지 | ${fmt(res.energy.totalEnergyUJ, 2)} uJ |`);
  lines.push("");

  lines.push(`## 2. 설정 요약`);
  lines.push(`| 하드웨어 | 값 |`);
  lines.push(`|---|---:|`);
  lines.push(`| 배열 | ${h.arrayRows} × ${h.arrayCols} |`);
  lines.push(`| 주파수 | ${h.frequencyMHz} MHz |`);
  lines.push(`| SRAM | ${h.sramKB} KiB |`);
  lines.push(`| Dataflow | ${h.dataflow} |`);
  lines.push(`| dtype bytes | ${h.bytesPerElement ?? 2} |`);
  if (h.memoryBandwidthGBs !== undefined) lines.push(`| DRAM BW | ${h.memoryBandwidthGBs} GB/s |`);
  lines.push("");

  lines.push(`## 2-1. 실제 외부 도구 반영 상태`);
  lines.push(`**최종 판정: 대기 중**`);
  lines.push("");
  lines.push(`- **TileForge estimator**: 적용됨 (${fmt(res.summary.totalCycles)} cycles)`);
  lines.push(`- **SCALE-Sim**: 대기 중 — full-pipeline 완료 후 COMPUTE_REPORT.csv 기준으로 갱신됩니다.`);
  lines.push(`- **IREE compile**: 대기 중 — model.vmfb 생성 여부로 갱신됩니다.`);
  lines.push("");

  lines.push(`## 3. 최적 타일 정책`);
  lines.push(`| op | M×N×K | tile | full-layer cycle | tile-policy cycle | util | confidence | tile scratch | layer working set |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const r of topRows(res.results, 12)) {
    const s = r.shape;
    const b = r.best;
    const fullCycles = (b as any).fullLayerCycles ?? b.cycles;
    const tilePolicy = (b as any).tilePolicyCycles ?? b.cycles;
    const tileScratch = ((b as any).tileScratchBytes ?? b.sramBytes ?? 0) / 1024;
    const layerSram = ((b as any).fullLayerSramBytes ?? b.sramBytes ?? 0) / 1024;
    lines.push(`| ${s.model}.${s.opName} | ${s.m}×${s.n}×${s.k} | ${b.tileM}×${b.tileN}×${b.tileK} | ${fmt(fullCycles)} | ${fmt(tilePolicy)} | ${pct(b.utilization)} | ${((b.predictionConfidence ?? 1) * 100).toFixed(0)}% | ${fmt(tileScratch, 1)} KiB | ${fmt(layerSram, 1)} KiB |`);
  }
  if (res.results.length > 12) lines.push(`| ... | 추가 ${res.results.length - 12}개 op 생략 |  |  |  |  |  |  |  |`);
  lines.push("");

  if (issues.length) {
    lines.push(`## 4. 확인이 필요한 항목`);
    for (const issue of issues) lines.push(`- ${issue}`);
    lines.push("");
  }

  lines.push(`## 5. IREE 최적화 힌트 해석`);
  lines.push(`- \`compiler_hints.md/json\`: op별 tile, workgroup, reduction, vector 후보를 분리해서 제공합니다.`);
  lines.push(`- \`iree_benchmark_plan.md/json\`: baseline과 hint variant를 분리하여 runtime A-B test 후보를 제공합니다.`);
  lines.push(`- \`iree-command.sh\`: 기본값은 안전한 baseline compile이며, transform.mlir 적용은 주석 처리된 실험 옵션입니다.`);
  lines.push(`- \`transform.mlir\`: TileForge가 추천한 lowering 방향을 담은 sketch입니다. IREE/MLIR 버전에 따라 op 이름과 handle이 바뀔 수 있습니다.`);
  lines.push(`- risk가 medium/high인 op는 SCALE-Sim 또는 IREE runtime benchmark로 A-B test한 뒤 compiler 옵션으로 확정하세요.`);
  lines.push("");

  lines.push(`## 6. Design-space 그래프 해석`);
  lines.push(`- **Array/Frequency**: 성능 향상 대비 비용 증가가 꺾이는 knee를 우선 확인합니다.`);
  lines.push(`- **SRAM**: 성능을 계속 올리는 축이라기보다, overflow 없이 줄일 수 있는 최소 안전 용량을 찾는 축입니다.`);
  lines.push(`- **DRAM BW**: 대역폭을 낮출 때 cycle이 급증하기 시작하는 지점이 knee입니다. 기준 이후가 평평하면 DRAM-bound가 아닙니다.`);
  lines.push(`- **M/N/K**: workload 크기가 바뀌므로 총 cycle이 아니라 ops/cycle 정규화 speedup으로 비교합니다.`);
  lines.push("");

  if (suite?.applied) {
    lines.push(`## 7. Estimator Suite`);
    lines.push(`- Learned Estimator Suite: 적용됨`);
    lines.push(`| 항목 | 값 |`);
    lines.push(`|---|---:|`);
    lines.push(`| 모델 target | ${suite.modelTargetScope ?? "mixed"} |`);
    lines.push(`| sample 수 | ${suite.modelSamples?.toLocaleString?.() ?? suite.modelSamples ?? "-"} |`);
    lines.push(`| full-layer 적용 | ${suite.appliedToFullLayer ? "예" : "아니오"} |`);
    lines.push(`| tile-policy 적용 | ${suite.appliedToTilePolicy ? "예" : "아니오"} |`);
    if (suite.fullLayerAnalyticalCycles !== undefined) lines.push(`| full-layer analytical | ${fmt(suite.fullLayerAnalyticalCycles)} |`);
    if (suite.fullLayerLearnedCycles !== undefined) lines.push(`| full-layer learned | ${fmt(suite.fullLayerLearnedCycles)} |`);
    if (suite.tilePolicyLearnedCycles !== undefined) lines.push(`| tile-policy learned | ${fmt(suite.tilePolicyLearnedCycles)} |`);
    if (suite.minDomainConfidence !== undefined) lines.push(`| domain confidence min | ${(suite.minDomainConfidence * 100).toFixed(0)}% |`);
    lines.push("");
  }

  lines.push(`## 8. 주요 산출물`);
  lines.push(`- report.md: 이 요약 보고서`);
  lines.push(`- validation_report.csv/md: SCALE-Sim 기준 layer별 오차`);
  lines.push(`- external_validation_report.md: 실제 SCALE-Sim/IREE 실행 로그 요약`);
  lines.push(`- best_tile_policy.csv: op별 타일 정책`);
  lines.push(`- compiler_hints.md/json: IREE lowering hint와 risk 설명`);
  lines.push(`- iree_benchmark_plan.md/json: baseline과 lowering hint 후보를 비교하기 위한 A-B test 계획`);
  lines.push(`- hardware_design_plan.md/json: array/SRAM/bandwidth/dataflow 설계 판단용 요약`);
  lines.push(`- tiling_strategy.md/json: op별 타일 선택 근거와 대안 후보`);
  lines.push(`- prediction_contract.json: full-layer/tile-policy/IREE hint의 의미 분리 계약`);
  lines.push(`- topology.csv / scalesim.cfg: SCALE-Sim 입력`);
  lines.push(`- summary.svg / design-space SVG: 시각화 산출물`);
  return lines.join("\n");
}
