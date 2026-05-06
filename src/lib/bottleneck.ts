import type { BottleneckAnalysis, SearchResponse, TileCandidateResult } from "@/types/domain";

function issueOf(b: TileCandidateResult, sramLimit: number): string {
  if (b.sramBytes > sramLimit) return "SRAM 초과";
  if (b.utilization < 0.45) return "PE 사용률 낮음";
  if (b.paddingRatio > 0.4) return "패딩 낭비 큼";
  if (b.tileK < 32) return "축소 차원 타일이 작음";
  return "계산량 지배";
}

export function analyzeBottlenecks(res: Pick<SearchResponse, "request"|"results"|"summary">): BottleneckAnalysis {
  const bests = res.results.map(r => r.best);
  const total = Math.max(1, bests.reduce((a,b)=>a+b.cycles,0));
  const sramLimit = res.request.hardware.sramKB * 1024;
  const topOps = bests.slice().sort((a,b)=>b.cycles-a.cycles).slice(0,8).map(b => ({ opName: b.opName, model: b.model, cycles: b.cycles, percent: b.cycles / total * 100, issue: issueOf(b, sramLimit) }));
  return {
    totalCycles: total,
    topOps,
    lowUtilizationOps: bests.filter(b=>b.utilization < 0.55).map(b=>`${b.model}.${b.opName}`),
    highPaddingOps: bests.filter(b=>b.paddingRatio > 0.25).map(b=>`${b.model}.${b.opName}`),
    sramRiskOps: bests.filter(b=>b.sramBytes > sramLimit * 0.8).map(b=>`${b.model}.${b.opName}`)
  };
}

export function bottleneckMarkdown(b?: BottleneckAnalysis): string {
  if (!b) return "병목 분석 데이터가 없습니다.";
  const rows = b.topOps.map((o,i)=>`${i+1}. ${o.model}.${o.opName}: ${o.cycles.toLocaleString()} 사이클 (${o.percent.toFixed(1)}%), ${o.issue}`).join("\n");
  return `# 4. 병목 분석\n\n전체 사이클: ${b.totalCycles.toLocaleString()}\n\n## 상위 병목 연산\n${rows}\n\nPE 사용률이 낮은 연산: ${b.lowUtilizationOps.join(", ") || "없음"}\n\n패딩 오버헤드가 큰 연산: ${b.highPaddingOps.join(", ") || "없음"}\n\nSRAM 위험 연산: ${b.sramRiskOps.join(", ") || "없음"}`;
}
