import type { SearchResponse } from "@/types/domain";

export interface ValidationSample { model?: string; opName: string; predictedCycles?: number; calibratedCycles?: number; scaleSimCycles?: number; ireeRuntimeUs?: number; measuredCycles?: number; }
export interface ValidationRow extends ValidationSample { referenceCycles?: number; estimatorErrorPct?: number; calibratedErrorPct?: number; source: "scalesim" | "iree" | "measured" | "missing"; }
export interface RankingMetrics { top1Agreement?: number; top3Recall?: number; top5Recall?: number; medianRegret?: number; spearman?: number; }
export interface ValidationReport { rows: ValidationRow[]; meanAbsEstimatorErrorPct?: number; meanAbsCalibratedErrorPct?: number; ranking?: RankingMetrics; markdown: string; csv: string; }

function num(v: string | undefined): number | undefined { if (v == null || v.trim() === "") return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function sourceKo(source: ValidationRow["source"]): string {
  return source === "measured" ? "실측" : source === "iree" ? "IREE" : source === "scalesim" ? "SCALE-Sim" : "없음";
}
export function parseValidationCsv(text: string): ValidationSample[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean); if (lines.length < 2) return [];
  const header = lines[0].split(",").map(h=>h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(",").map(c=>c.trim()); const r: Record<string,string> = {};
    header.forEach((h,i)=>r[h]=cols[i] ?? "");
    return { model: r.model, opName: r.op_name || r.opName, predictedCycles: num(r.predicted_cycles), calibratedCycles: num(r.calibrated_cycles), scaleSimCycles: num(r.scalesim_cycles || r.scaleSimCycles), ireeRuntimeUs: num(r.iree_runtime_us || r.runtime_us), measuredCycles: num(r.measured_cycles) };
  }).filter(s=>s.opName);
}
export function buildValidationReport(response: SearchResponse, samples: ValidationSample[] = []): ValidationReport {
  const sampleMap = new Map(samples.map(s => [`${s.model ?? ""}:${s.opName}`, s]));
  const rows: ValidationRow[] = response.results.map(r => {
    const best = r.best;
    const s = sampleMap.get(`${r.shape.model}:${r.shape.opName}`) ?? sampleMap.get(`:${r.shape.opName}`);
    const predictedCycles = s?.predictedCycles ?? best.rawCycles ?? best.cycles;
    const calibratedCycles = s?.calibratedCycles ?? best.cycles;
    const referenceCycles = s?.scaleSimCycles ?? s?.measuredCycles ?? (s?.ireeRuntimeUs ? s.ireeRuntimeUs * response.request.hardware.frequencyMHz : undefined);
    const source = s?.scaleSimCycles ? "scalesim" : s?.measuredCycles ? "measured" : s?.ireeRuntimeUs ? "iree" : "missing";
    const estimatorErrorPct = referenceCycles ? ((predictedCycles - referenceCycles) / referenceCycles) * 100 : undefined;
    const calibratedErrorPct = referenceCycles ? ((calibratedCycles - referenceCycles) / referenceCycles) * 100 : undefined;
    return { model: r.shape.model, opName: r.shape.opName, predictedCycles, calibratedCycles, scaleSimCycles: s?.scaleSimCycles, ireeRuntimeUs: s?.ireeRuntimeUs, measuredCycles: s?.measuredCycles, referenceCycles, estimatorErrorPct, calibratedErrorPct, source };
  });
  const absEst = rows.map(r=>r.estimatorErrorPct).filter((v): v is number => v != null).map(Math.abs);
  const absCal = rows.map(r=>r.calibratedErrorPct).filter((v): v is number => v != null).map(Math.abs);
  const mean = (xs:number[]) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : undefined;
  const ranking = computeRankingMetrics(rows);
  const csv = ["모델,연산,예측_사이클,보정_사이클,기준_사이클,기준_출처,예측_오차_pct,보정_오차_pct", ...rows.map(r=>[r.model,r.opName,r.predictedCycles,r.calibratedCycles,r.referenceCycles,sourceKo(r.source),r.estimatorErrorPct?.toFixed(3),r.calibratedErrorPct?.toFixed(3)].join(","))].join("\n");
  const markdown = [`# 정확도 검증 보고서`, "", `Estimator 평균 절대 오차: ${mean(absEst)?.toFixed(2) ?? "해당 없음"}%`, `보정 후 평균 절대 오차: ${mean(absCal)?.toFixed(2) ?? "해당 없음"}%`, `Spearman 순위 상관계수: ${ranking.spearman?.toFixed(3) ?? "해당 없음"}`, `중앙 regret 비율: ${ranking.medianRegret?.toFixed(3) ?? "해당 없음"}`, "", "| 연산 | 예측 | 보정 | 기준값 | 기준 출처 | 예측 오차 | 보정 오차 |", "|---|---:|---:|---:|---|---:|---:|", ...rows.map(r=>`| ${r.opName} | ${Math.round(r.predictedCycles ?? 0)} | ${Math.round(r.calibratedCycles ?? 0)} | ${r.referenceCycles ? Math.round(r.referenceCycles) : "해당 없음"} | ${sourceKo(r.source)} | ${r.estimatorErrorPct?.toFixed(2) ?? "해당 없음"}% | ${r.calibratedErrorPct?.toFixed(2) ?? "해당 없음"}% |`)].join("\n");
  return { rows, meanAbsEstimatorErrorPct: mean(absEst), meanAbsCalibratedErrorPct: mean(absCal), ranking, markdown, csv };
}

function computeRankingMetrics(rows: ValidationRow[]): RankingMetrics {
  const measured = rows.filter(r => r.referenceCycles && r.calibratedCycles);
  if (measured.length < 2) return {};
  const byPred = measured.slice().sort((a,b)=>(a.calibratedCycles ?? Infinity)-(b.calibratedCycles ?? Infinity));
  const byRef = measured.slice().sort((a,b)=>(a.referenceCycles ?? Infinity)-(b.referenceCycles ?? Infinity));
  const refBest = byRef[0];
  const top1Agreement = byPred[0].opName === refBest.opName ? 1 : 0;
  const top3 = new Set(byPred.slice(0,3).map(r=>r.opName));
  const top5 = new Set(byPred.slice(0,5).map(r=>r.opName));
  const refTop3 = byRef.slice(0,3).map(r=>r.opName);
  const refTop5 = byRef.slice(0,5).map(r=>r.opName);
  const top3Recall = refTop3.length ? refTop3.filter(x=>top3.has(x)).length / refTop3.length : undefined;
  const top5Recall = refTop5.length ? refTop5.filter(x=>top5.has(x)).length / refTop5.length : undefined;
  const regret = byPred.map((r,i)=>((r.referenceCycles ?? 1) / Math.max(1, byRef[Math.min(i, byRef.length-1)].referenceCycles ?? 1))).sort((a,b)=>a-b);
  const medianRegret = regret[Math.floor(regret.length/2)];
  const spearman = spearmanRank(measured.map(r=>r.calibratedCycles ?? 0), measured.map(r=>r.referenceCycles ?? 0));
  return { top1Agreement, top3Recall, top5Recall, medianRegret, spearman };
}
function rank(xs: number[]): number[] { return xs.map((x,i)=>({x,i})).sort((a,b)=>a.x-b.x).reduce((acc,o,r)=>{ acc[o.i]=r+1; return acc; }, Array(xs.length).fill(0)); }
function spearmanRank(a: number[], b: number[]): number | undefined {
  if (a.length !== b.length || a.length < 2) return undefined;
  const ra = rank(a), rb = rank(b); const n = a.length;
  const d2 = ra.reduce((sum,r,i)=>sum+(r-rb[i])**2,0);
  return 1 - (6*d2)/(n*(n*n-1));
}
