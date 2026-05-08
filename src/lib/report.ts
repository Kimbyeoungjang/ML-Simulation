import type { SearchResponse, TileCandidateResult } from "@/types/domain";
import { profileToMarkdown } from "./calibration";
import { bottleneckMarkdown } from "./bottleneck";
import { rooflineMarkdown } from "./roofline";
import { energyMarkdown } from "./energy";
import { fusionMarkdown, analyzeFusion } from "./fusion";
import { validityMarkdown } from "./validity";

function fmtInt(v: number | undefined): string {
  return Number.isFinite(v) ? Math.round(v as number).toLocaleString() : "-";
}

function fmtFixed(v: number | undefined, digits = 2): string {
  return Number.isFinite(v) ? (v as number).toFixed(digits) : "-";
}

function fmtPct(v: number | undefined, digits = 1): string {
  return Number.isFinite(v) ? `${((v as number) * 100).toFixed(digits)}%` : "-";
}

function fmtKiB(bytes: number | undefined, digits = 1): string {
  return Number.isFinite(bytes) ? `${((bytes as number) / 1024).toFixed(digits)} KiB` : "-";
}

function tileName(t: Pick<TileCandidateResult, "tileM" | "tileN" | "tileK">): string {
  return `${t.tileM}×${t.tileN}×${t.tileK}`;
}

function sum(values: Array<number | undefined>): number {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? Number(v) : 0), 0);
}

function dataflowName(dataflow: string | undefined): string {
  if (dataflow === "WS") return "WS — Weight Stationary";
  if (dataflow === "OS") return "OS — Output Stationary";
  if (dataflow === "IS") return "IS — Input Stationary";
  return dataflow ?? "-";
}

export function generateReportMarkdown(res: SearchResponse): string {
  const h = res.request.hardware;
  const shapes = res.request.shapes;
  const totalSramAccess = sum(res.results.map((r) => r.best.predictedSramAccessBytes));
  const totalDramAccess = sum(res.results.map((r) => r.best.predictedDramAccessBytes));
  const worstPadding = [...res.results].sort((a, b) => b.best.paddingRatio - a.best.paddingRatio)[0];
  const worstSram = [...res.results].sort((a, b) => b.best.sramBytes - a.best.sramBytes)[0];
  const bestUtil = [...res.results].sort((a, b) => b.best.utilization - a.best.utilization)[0];
  const lines: string[] = [];

  lines.push("# TileForge 분석 보고서", "");
  lines.push(`> 생성 시각: ${new Date().toISOString()}`);
  lines.push("> 이 문서는 TileForge estimator 기준의 기본 보고서입니다. Full-pipeline 실행 후에는 같은 report.md 뒤쪽에 SCALE-Sim/IREE 실제 검증 섹션이 자동으로 추가됩니다.", "");

  lines.push("## 1. 한눈에 보는 결론", "");
  lines.push("| 항목 | 값 | 해석 |", "|---|---:|---|");
  lines.push(`| 전체 예상 cycle | ${fmtInt(res.summary.totalCycles)} | TileForge가 선택한 tile 정책을 전체 workload에 적용한 tiled total cycle입니다. |`);
  lines.push(`| 전체 예상 시간 | ${fmtFixed(res.summary.totalTimeUs, 3)} us | 주파수 ${h.frequencyMHz} MHz 기준입니다. |`);
  lines.push(`| 평균 PE 사용률 | ${fmtPct(res.summary.meanUtilization, 2)} | 높을수록 array가 잘 채워진 것입니다. |`);
  lines.push(`| 평균 패딩 비율 | ${fmtPct(res.summary.meanPaddingRatio, 2)} | 낮을수록 tile 경계 낭비가 적습니다. |`);
  lines.push(`| 최대 SRAM 작업 영역 | ${fmtKiB(res.summary.maxSramBytes)} | capacity footprint입니다. access traffic과 구분해야 합니다. |`);
  lines.push(`| 예상 SRAM access traffic | ${fmtKiB(totalSramAccess)} | 전체 tiled workload 기준 추정 접근량입니다. |`);
  lines.push(`| 예상 DRAM access traffic | ${fmtKiB(totalDramAccess)} | 전체 tiled workload 기준 추정 접근량입니다. |`);
  lines.push(`| 병목 연산 | ${res.summary.bottleneckOp || "-"} | cycle 비중이 가장 큰 연산입니다. |`);
  lines.push(`| 예상 에너지 | ${res.energy?.totalEnergyUJ !== undefined ? `${fmtFixed(res.energy.totalEnergyUJ, 2)} uJ` : "해당 없음"} | 에너지 모델 설정이 있을 때 계산됩니다. |`, "");

  lines.push("## 2. 기준과 단위", "");
  lines.push("- **TileForge cycle**: 선택된 tile을 전체 M×N×K workload에 반복 적용한 전체 tiled cycle입니다.");
  lines.push("- **SCALE-Sim full topology cycle**: topology.csv row/layer 단위 sanity check입니다. TileForge tiled total과 직접 오차율로 비교하지 않습니다.");
  lines.push("- **SCALE-Sim top3 tile 검증**: TileForge 상위 tile 후보를 SCALE-Sim에 넣고, layout 1회 cycle × tileCount로 전체 cycle을 환산한 값입니다. estimator 정확도 판단은 이 기준을 우선 사용합니다.");
  lines.push("- **SRAM 작업 영역**은 동시에 필요한 local buffer capacity입니다. **SRAM/DRAM access traffic**은 실행 중 발생한 접근량입니다. 두 값은 단위와 의미가 다릅니다.", "");

  lines.push("## 2-1. 실제 외부 도구 반영 상태", "");
  lines.push("**최종 판정: 대기 중**", "");
  lines.push("| 도구 | 상태 | 의미 |", "|---|---|---|");
  lines.push(`| TileForge estimator | 적용됨 | 전체 예상 cycle ${fmtInt(res.summary.totalCycles)} 산출 완료 |`);
  lines.push("| SCALE-Sim full topology | 대기 중 | full-pipeline 완료 후 COMPUTE_REPORT.csv sanity check가 추가됩니다. | ");
  lines.push("| SCALE-Sim top3 tile 검증 | 대기 중 | 상위 tile 후보의 layout cycle과 전체 환산 cycle이 추가됩니다. | ");
  lines.push("| IREE compile | 대기 중 | generated.mlir 컴파일 가능성과 VMFB 생성 여부가 추가됩니다. |", "");

  lines.push("## 2-2. 예측 결과와 실제 실행 결과 비교", "");
  lines.push("| 항목 | TileForge estimator | SCALE-Sim/IREE 실제 실행 | 해석 |", "|---|---:|---:|---|");
  lines.push(`| 전체 tiled cycle | ${fmtInt(res.summary.totalCycles)} | 대기 중 | 새 job의 full-pipeline 완료 후 top3 tile 검증 기준으로 실제 비교값이 추가됩니다. |`);
  lines.push(`| SRAM access traffic | ${fmtKiB(totalSramAccess)} | 대기 중 | SCALE-Sim access report는 element count × 원소당 byte로 KiB 환산합니다. |`);
  lines.push(`| DRAM access traffic | ${fmtKiB(totalDramAccess)} | 대기 중 | full topology sanity check와 top3 tile 검증을 분리해서 봅니다. |`, "");

  lines.push("## 3. 하드웨어 및 실행 설정", "");
  lines.push("| 구분 | 설정 |", "|---|---:|");
  lines.push(`| 하드웨어 이름 | ${h.name} |`);
  lines.push(`| PE 배열 | ${h.arrayRows} × ${h.arrayCols} |`);
  lines.push(`| 데이터플로우 | ${dataflowName(h.dataflow)} |`);
  lines.push(`| 주파수 | ${h.frequencyMHz} MHz |`);
  lines.push(`| 전체 SRAM | ${h.sramKB} KiB |`);
  lines.push(`| 원소당 byte | ${h.bytesPerElement} B |`);
  lines.push(`| 메모리 대역폭 | ${h.memoryBandwidthGBs ?? "미설정"} GB/s |`);
  lines.push(`| 디스패치 오버헤드 | ${h.dispatchOverheadUs ?? "미설정"} us |`);
  lines.push(`| Objective | ${res.request.objective} |`, "");

  lines.push("## 4. Workload 요약", "");
  lines.push("| # | 모델 | 연산 | M | N | K | dtype | MACs |", "|---:|---|---|---:|---:|---:|---:|---:|");
  shapes.forEach((s, index) => {
    const macs = Number(s.m) * Number(s.n) * Number(s.k);
    lines.push(`| ${index + 1} | ${s.model} | ${s.opName} | ${fmtInt(s.m)} | ${fmtInt(s.n)} | ${fmtInt(s.k)} | ${s.dtypeBytes} B | ${fmtInt(macs)} |`);
  });
  lines.push("");

  lines.push("## 5. 최적 타일 정책", "");
  lines.push("| 모델 | 연산 | 선택 tile | cycle | 시간(us) | PE 사용률 | 패딩 | SRAM 영역 | SRAM access | DRAM access | memory-bound | 주요 경고 |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const r of res.results) {
    const b = r.best;
    lines.push(`| ${r.shape.model} | ${r.shape.opName} | ${tileName(b)} | ${fmtInt(b.cycles)} | ${fmtFixed(b.timeUs, 3)} | ${fmtPct(b.utilization)} | ${fmtPct(b.paddingRatio)} | ${fmtKiB(b.sramBytes)} | ${fmtKiB(b.predictedSramAccessBytes)} | ${fmtKiB(b.predictedDramAccessBytes)} | ${fmtFixed(b.memoryBoundRatio, 2)}× | ${(b.warnings ?? []).join("<br>") || "-"} |`);
  }
  lines.push("");

  lines.push("## 6. 병목과 위험 신호", "");
  lines.push("| 항목 | 값 | 확인할 점 |", "|---|---:|---|");
  lines.push(`| cycle 병목 | ${res.summary.bottleneckOp || "-"} | 전체 cycle 비중이 큰 연산부터 tile 후보와 dataflow를 재검토하세요. |`);
  lines.push(`| 최악 패딩 | ${worstPadding ? `${worstPadding.shape.model}.${worstPadding.shape.opName} (${fmtPct(worstPadding.best.paddingRatio)})` : "-"} | tileM/tileN/tileK가 shape 차원과 잘 나누어지는지 확인합니다. |`);
  lines.push(`| 최대 SRAM 영역 | ${worstSram ? `${worstSram.shape.model}.${worstSram.shape.opName} (${fmtKiB(worstSram.best.sramBytes)})` : "-"} | SRAM capacity risk와 access traffic은 따로 봐야 합니다. |`);
  lines.push(`| 최고 PE 사용률 | ${bestUtil ? `${bestUtil.shape.model}.${bestUtil.shape.opName} (${fmtPct(bestUtil.best.utilization)})` : "-"} | 이 연산의 tile 형태를 다른 연산 후보에도 참고할 수 있습니다. |`, "");

  if (res.bottlenecks) {
    lines.push("### 6-1. 병목 분석 상세", "", bottleneckMarkdown(res.bottlenecks), "");
  }
  if (res.roofline) {
    lines.push("## 7. Roofline 관점", "", rooflineMarkdown(res.roofline), "");
  }
  if (res.energy) {
    lines.push("## 8. 에너지 추정", "", energyMarkdown(res.energy), "");
  }

  lines.push("## 9. 타일 선택 이유", "");
  for (const r of res.results) {
    lines.push(`- **${r.shape.model}.${r.shape.opName} / ${tileName(r.best)}**: ${r.best.explanation}`);
  }
  lines.push("");

  lines.push("## 10. 모델 타당성 및 fusion 힌트", "", validityMarkdown(h, res.request.shapes, res.results.map((r) => r.best)), "", fusionMarkdown(analyzeFusion(res.request.shapes)), "");

  lines.push("## 11. 보정 정보", "");
  lines.push("```text", profileToMarkdown(res.request.calibration), "```", "");

  lines.push("## 12. 하드웨어 설계 조언", "");
  for (const a of res.designAdvice) lines.push(`- ${a}`);
  if (res.designAdvice.length === 0) lines.push("- 현재 설정에서는 추가 조언이 없습니다.");
  lines.push("");

  lines.push("## 13. IREE 실행 명령", "");
  lines.push("```bash", res.artifacts.ireeCommand ?? "생성된 IREE 명령 artifact를 확인하세요.", "```", "");

  lines.push("## 14. 생성된 산출물", "");
  lines.push("| 파일 | 내용 |", "|---|---|");
  lines.push("| best_tile_policy.csv | 최적 tile 정책 표 | ");
  lines.push("| generated.mlir | IREE/MLIR lowering 참고용 MLIR 스케치 | ");
  lines.push("| transform.mlir | Transform dialect 스케치 | ");
  lines.push("| scalesim.cfg | SCALE-Sim 설정 파일 | ");
  lines.push("| topology.csv | SCALE-Sim full topology 입력 파일 | ");
  lines.push("| layout_top3.csv | top3 tile 검증용 layout CSV | ");
  lines.push("| scalesim_summary.json | SCALE-Sim full topology 및 후보 검증 요약 | ");
  lines.push("| scalesim_top3_summary.json | top3 tile 검증 전용 요약 | ");
  lines.push("| external_validation_report.md | 외부 도구 상세 검증 부록 | ");
  lines.push("| summary.svg | 병목 연산 요약 그래프 |", "");

  lines.push("## 15. 읽는 순서 추천", "");
  lines.push("1. 먼저 **1. 한눈에 보는 결론**에서 전체 cycle, PE 사용률, SRAM/DRAM traffic을 확인합니다.");
  lines.push("2. **5. 최적 타일 정책**에서 선택 tile과 memory-bound ratio를 봅니다.");
  lines.push("3. Full-pipeline 실행 후에는 뒤쪽에 추가되는 **실제 외부 도구 검증 보고서**에서 SCALE-Sim top3 tile 검증을 우선 확인합니다.");
  lines.push("4. full topology cycle은 sanity check이고, estimator 정확도 평가는 top3 tile 검증 기준으로 해석합니다.");

  return lines.join("\n");
}
