"use client";

import { apiFetch } from "@/lib/apiClient";
import { useEffect, useMemo, useState } from "react";
import { ActionButton, Artifact, MarkdownView, type DownloadFn } from "./primitives";

function fmt(value: unknown, digits = 2): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - pos) + sorted[hi] * (pos - lo);
}

function sameShape(a: any, b: any): boolean {
  return Number(a?.m) === Number(b?.m) && Number(a?.n) === Number(b?.n) && Number(a?.k) === Number(b?.k);
}

function sameOp(a: any, b: any): boolean {
  if (a?.id && b?.id && String(a.id) === String(b.id)) return true;
  if (sameShape(a, b)) return true;
  return String(a?.model || "") === String(b?.model || "") && String(a?.opName || "") === String(b?.opName || "") && sameShape(a, b);
}

async function postTpu(action: string, body: Record<string, unknown>) {
  const res = await apiFetch("/api/tpu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) throw new Error(json?.error || json?.detail || `TPU API failed: ${res.status}`);
  return json;
}

function TpuDistributionChart({ rows, sampleRows }: { rows: any[]; sampleRows: any[] }) {
  const groups = useMemo(() => rows.slice(0, 12).map((row) => {
    const samples = sampleRows.filter((sample) => sameOp(row, sample)).map((sample) => Number(sample.measuredUs)).filter(Number.isFinite);
    const fallback = Number(row.measuredUs);
    return {
      key: row.id || `${row.model}.${row.opName}.${row.m}x${row.n}x${row.k}`,
      label: `${row.opName || row.id || "op"}`,
      shape: `${row.m}x${row.n}x${row.k}`,
      predicted: Number(row.predictedTimeUs),
      measured: samples.length ? samples : (Number.isFinite(fallback) ? [fallback] : []),
      summaryMeasured: fallback,
    };
  }).filter((group) => Number.isFinite(group.predicted) && group.measured.length > 0), [rows, sampleRows]);

  if (!groups.length) return null;

  const width = Math.max(760, groups.length * 118 + 120);
  const height = 360;
  const margin = { left: 58, right: 26, top: 28, bottom: 86 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const allValues = groups.flatMap((group) => [group.predicted, ...group.measured]);
  const minRaw = Math.min(...allValues);
  const maxRaw = Math.max(...allValues);
  const pad = Math.max(1, (maxRaw - minRaw) * 0.12);
  const yMin = Math.max(0, minRaw - pad);
  const yMax = maxRaw + pad;
  const y = (value: number) => margin.top + innerH - ((value - yMin) / Math.max(1e-9, yMax - yMin)) * innerH;
  const x = (index: number) => margin.left + (groups.length === 1 ? innerW / 2 : (index / (groups.length - 1)) * innerW);
  const ticks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);

  return (
    <div className="tpu-chart-card" title="각 점은 TPU 반복 실행 raw sample이고, 짧은 가로선은 TileForge 예측 시간입니다.">
      <div className="artifact-toolbar">
        <strong>TPU 반복 측정 분포 vs TileForge 예측</strong>
        <span className="badge">raw samples {sampleRows.length}</span>
        <span className="badge">ops {groups.length}</span>
      </div>
      <div className="small">
        점들은 TPU 반복 측정값, 굵은 점은 측정 median, 가로 기준선은 TileForge 예측값입니다. 예측선이 분포 중앙에 가까울수록 실제 성능에 근접합니다.
      </div>
      <div className="chart-scroll">
        <svg className="tpu-distribution-svg" width={width} height={height} role="img" aria-label="TPU timing distribution chart">
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="tpu-chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
              <text className="tpu-chart-axis" x={margin.left - 10} y={y(tick) + 4} textAnchor="end">{fmt(tick)}</text>
            </g>
          ))}
          <text className="tpu-chart-axis" x={margin.left} y={18}>time (µs)</text>
          {groups.map((group, index) => {
            const cx = x(index);
            const values = group.measured;
            const p10 = quantile(values, 0.1);
            const p90 = quantile(values, 0.9);
            const med = median(values);
            const min = Math.min(...values);
            const max = Math.max(...values);
            const clipped = values.slice(0, 120);
            return (
              <g key={group.key}>
                <line className="tpu-chart-whisker" x1={cx} x2={cx} y1={y(min)} y2={y(max)} />
                <rect className="tpu-chart-band" x={cx - 18} y={y(p90)} width={36} height={Math.max(2, y(p10) - y(p90))} rx={6} />
                <line className="tpu-chart-pred" x1={cx - 28} x2={cx + 28} y1={y(group.predicted)} y2={y(group.predicted)} />
                {clipped.map((value, sampleIndex) => {
                  const jitter = ((sampleIndex % 9) - 4) * 4;
                  return <circle key={`${group.key}-${sampleIndex}`} className="tpu-chart-sample" cx={cx + jitter} cy={y(value)} r={2.4} />;
                })}
                <circle className="tpu-chart-median" cx={cx} cy={y(med)} r={5} />
                <text className="tpu-chart-label" x={cx} y={height - 48} textAnchor="middle">{group.label.slice(0, 16)}</text>
                <text className="tpu-chart-axis" x={cx} y={height - 30} textAnchor="middle">{group.shape}</text>
                <text className="tpu-chart-axis" x={cx} y={height - 12} textAnchor="middle">ratio {fmt(med / group.predicted, 2)}x</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="report-status-strip compact-status-strip">
        <span className="badge">예측선</span>
        <span className="badge">TPU sample 점</span>
        <span className="badge">TPU median 굵은 점</span>
        <span className="badge">P10~P90 band</span>
      </div>
    </div>
  );
}

function tpuTflops(row: any, timeUs: number): number {
  return (2 * Number(row.m) * Number(row.n) * Number(row.k)) / Math.max(1e-9, timeUs) / 1e6;
}

function candidateKey(row: any, index: number): string {
  return [row.id || `row_${index}`, row.model, row.opName, row.m, row.n, row.k, row.bestTileM, row.bestTileN, row.bestTileK].join("|");
}

function rankCandidates(items: any[], valueKey: "predictedMetric" | "measuredMetric", lowerIsBetter: boolean): Map<string, number> {
  const sorted = [...items].sort((a, b) => lowerIsBetter ? a[valueKey] - b[valueKey] : b[valueKey] - a[valueKey]);
  const ranks = new Map<string, number>();
  sorted.forEach((item, index) => ranks.set(item.key, index + 1));
  return ranks;
}

function spearmanRank(items: any[]): number | null {
  if (items.length < 2) return null;
  const n = items.length;
  const meanPred = items.reduce((sum, item) => sum + item.predictedRank, 0) / n;
  const meanMeas = items.reduce((sum, item) => sum + item.measuredRank, 0) / n;
  let cov = 0;
  let vp = 0;
  let vm = 0;
  for (const item of items) {
    const dp = item.predictedRank - meanPred;
    const dm = item.measuredRank - meanMeas;
    cov += dp * dm;
    vp += dp * dp;
    vm += dm * dm;
  }
  const denom = Math.sqrt(vp * vm);
  return denom > 0 ? cov / denom : null;
}

function buildRecommendationView(rows: any[]) {
  const candidates = rows.filter((row) => Number.isFinite(Number(row.predictedTimeUs)) && Number.isFinite(Number(row.measuredUs)));
  if (candidates.length < 2) return null;
  const shapeSet = new Set(candidates.map((row) => `${row.m}x${row.n}x${row.k}`));
  const mode = shapeSet.size === 1 ? "runtime" : "throughput";
  const lowerIsBetter = mode === "runtime";
  const items = candidates.map((row, index) => {
    const measuredUs = Number(row.measuredUs);
    const predictedUs = Number(row.predictedTimeUs);
    const measuredMetric = mode === "runtime" ? measuredUs : Number(row.achievedTflops || tpuTflops(row, measuredUs));
    const predictedMetric = mode === "runtime" ? predictedUs : tpuTflops(row, predictedUs);
    return {
      key: candidateKey(row, index),
      label: String(row.opName || row.id || `candidate_${index + 1}`),
      shape: `${row.m}x${row.n}x${row.k}`,
      tile: `${row.bestTileM || "?"}x${row.bestTileN || "?"}x${row.bestTileK || "?"}`,
      row,
      measuredMetric,
      predictedMetric,
    };
  });
  const predictedRanks = rankCandidates(items, "predictedMetric", lowerIsBetter);
  const measuredRanks = rankCandidates(items, "measuredMetric", lowerIsBetter);
  const ranked = items.map((item) => ({
    ...item,
    predictedRank: predictedRanks.get(item.key) ?? items.length,
    measuredRank: measuredRanks.get(item.key) ?? items.length,
  }));
  const predictedBest = ranked.find((item) => item.predictedRank === 1) ?? ranked[0];
  const measuredBest = ranked.find((item) => item.measuredRank === 1) ?? ranked[0];
  const regret = lowerIsBetter
    ? ((predictedBest.measuredMetric - measuredBest.measuredMetric) / Math.max(1e-9, measuredBest.measuredMetric)) * 100
    : ((measuredBest.measuredMetric - predictedBest.measuredMetric) / Math.max(1e-9, measuredBest.measuredMetric)) * 100;
  return {
    mode,
    lowerIsBetter,
    unit: mode === "runtime" ? "µs" : "TFLOPS",
    items: ranked.sort((a, b) => a.measuredRank - b.measuredRank),
    predictedBest,
    measuredBest,
    top1Hit: predictedBest.key === measuredBest.key,
    top3Hit: predictedBest.measuredRank <= 3,
    regretPercent: Math.max(0, regret),
    spearman: spearmanRank(ranked),
  };
}

function TpuRecommendationChart({ rows }: { rows: any[] }) {
  const view = useMemo(() => buildRecommendationView(rows), [rows]);
  if (!view) return null;
  const shown = view.items.slice(0, 18);
  const width = Math.max(800, shown.length * 92 + 150);
  const height = 390;
  const margin = { left: 64, right: 28, top: 30, bottom: 110 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const values = shown.flatMap((item) => [item.measuredMetric, item.predictedMetric]).filter(Number.isFinite);
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const yMin = view.lowerIsBetter ? 0 : Math.max(0, minValue * 0.88);
  const yMax = maxValue * 1.12;
  const y = (value: number) => margin.top + innerH - ((value - yMin) / Math.max(1e-9, yMax - yMin)) * innerH;
  const barW = Math.min(44, innerW / Math.max(1, shown.length) * 0.54);
  const step = innerW / Math.max(1, shown.length);
  const ticks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) * i) / 4);
  const title = view.mode === "runtime" ? "추천 우수성 검증: 같은 MNK 후보의 runtime 비교" : "추천 우수성 검증: MNK 후보의 실제 처리량 비교";
  const description = view.mode === "runtime"
    ? "같은 MNK에서는 실행 시간이 낮을수록 좋습니다. 주황 테두리는 TileForge가 예측상 최고로 고른 후보, 진한 막대는 TPU 실측 최고 후보입니다."
    : "MNK가 서로 다르면 절대 시간 대신 TFLOPS가 높을수록 좋은 후보로 봅니다. 주황 테두리는 TileForge 예측 최고, 진한 막대는 TPU 실측 최고입니다.";
  return (
    <div className="tpu-chart-card" title="TileForge 추천 후보가 실제 TPU 측정에서도 좋은 순위를 유지하는지 검증합니다.">
      <div className="artifact-toolbar">
        <strong>{title}</strong>
        <span className={view.top1Hit ? "badge ok-badge" : view.top3Hit ? "badge warn-badge" : "badge"}>Top-1 {view.top1Hit ? "hit" : "miss"}</span>
        <span className={view.top3Hit ? "badge ok-badge" : "badge warn-badge"}>Top-3 {view.top3Hit ? "hit" : "miss"}</span>
        <span className="badge">regret {fmt(view.regretPercent)}%</span>
        <span className="badge">ρ {view.spearman === null ? "n/a" : fmt(view.spearman, 3)}</span>
      </div>
      <div className="small">{description}</div>
      <div className="recommendation-summary-grid">
        <div><span className="mini-field-label">TileForge 예측 1등</span><strong>{view.predictedBest.label}</strong><small>{view.predictedBest.shape} · tile {view.predictedBest.tile}</small></div>
        <div><span className="mini-field-label">TPU 실측 1등</span><strong>{view.measuredBest.label}</strong><small>{view.measuredBest.shape} · tile {view.measuredBest.tile}</small></div>
        <div><span className="mini-field-label">예측 1등의 실측 순위</span><strong>{view.predictedBest.measuredRank} / {view.items.length}</strong><small>실제 최적 대비 손해 {fmt(view.regretPercent)}%</small></div>
      </div>
      <div className="chart-scroll">
        <svg className="tpu-distribution-svg" width={width} height={height} role="img" aria-label="TPU recommendation ranking chart">
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="tpu-chart-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
              <text className="tpu-chart-axis" x={margin.left - 10} y={y(tick) + 4} textAnchor="end">{fmt(tick, view.mode === "runtime" ? 1 : 2)}</text>
            </g>
          ))}
          <text className="tpu-chart-axis" x={margin.left} y={18}>{view.mode === "runtime" ? "runtime (µs), lower is better" : "achieved TFLOPS, higher is better"}</text>
          {shown.map((item, index) => {
            const cx = margin.left + step * index + step / 2;
            const top = y(item.measuredMetric);
            const base = y(yMin);
            const barH = Math.max(2, base - top);
            const predictedY = y(item.predictedMetric);
            const isPredicted = item.key === view.predictedBest.key;
            const isMeasured = item.key === view.measuredBest.key;
            return (
              <g key={item.key}>
                <rect className={isMeasured ? "tpu-rank-bar measured-best" : "tpu-rank-bar"} x={cx - barW / 2} y={top} width={barW} height={barH} rx={8} />
                {isPredicted && <rect className="tpu-rank-predicted-outline" x={cx - barW / 2 - 4} y={top - 4} width={barW + 8} height={barH + 8} rx={10} />}
                <line className="tpu-chart-pred" x1={cx - barW / 2 - 8} x2={cx + barW / 2 + 8} y1={predictedY} y2={predictedY} />
                <text className="tpu-chart-axis" x={cx} y={top - 8} textAnchor="middle">#{item.measuredRank}</text>
                <text className="tpu-chart-label" x={cx} y={height - 72} textAnchor="middle">{item.label.slice(0, 12)}</text>
                <text className="tpu-chart-axis" x={cx} y={height - 53} textAnchor="middle">{item.shape}</text>
                <text className="tpu-chart-axis" x={cx} y={height - 35} textAnchor="middle">pred #{item.predictedRank}</text>
                <text className="tpu-chart-axis" x={cx} y={height - 17} textAnchor="middle">{fmt(item.measuredMetric, view.mode === "runtime" ? 1 : 2)} {view.unit}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="report-status-strip compact-status-strip">
        <span className="badge">막대: TPU 실측 성능</span>
        <span className="badge">가로선: TileForge 예측 성능</span>
        <span className="badge">주황 테두리: 예측 1등</span>
        <span className="badge">진한 막대: 실측 1등</span>
      </div>
    </div>
  );
}


export function TpuComparisonPanel({
  request,
  download,
}: {
  request: any;
  download: DownloadFn;
}) {
  const [webRunEnabled, setWebRunEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [predictionsCsv, setPredictionsCsv] = useState("");
  const [runnerPy, setRunnerPy] = useState("");
  const [readme, setReadme] = useState("");
  const [measurementsCsv, setMeasurementsCsv] = useState("");
  const [samplesCsv, setSamplesCsv] = useState("");
  const [comparisonCsv, setComparisonCsv] = useState("");
  const [calibrationCsv, setCalibrationCsv] = useState("");
  const [sampleComparisonCsv, setSampleComparisonCsv] = useState("");
  const [summaryMd, setSummaryMd] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [sampleRows, setSampleRows] = useState<any[]>([]);
  const [stats, setStats] = useState<any | null>(null);
  const [runLog, setRunLog] = useState("");
  const [reps, setReps] = useState(30);
  const [warmup, setWarmup] = useState(5);

  const shapeCount = Array.isArray(request?.shapes) ? request.shapes.length : 0;
  const requestLabel = useMemo(() => {
    const hw = request?.hardware;
    if (!hw) return "현재 설정";
    return `${hw.name ?? "custom"} · ${hw.arrayRows}x${hw.arrayCols} · ${hw.frequencyMHz} MHz · ${shapeCount} ops`;
  }, [request, shapeCount]);

  useEffect(() => {
    apiFetch("/api/tpu")
      .then((r) => r.json())
      .then((j) => setWebRunEnabled(Boolean(j.webRunEnabled)))
      .catch(() => setWebRunEnabled(false));
  }, []);

  function clearComparison() {
    setComparisonCsv("");
    setCalibrationCsv("");
    setSampleComparisonCsv("");
    setSummaryMd("");
    setRows([]);
    setSampleRows([]);
    setStats(null);
  }

  async function preparePackage() {
    setBusy(true);
    setMessage("");
    try {
      const json = await postTpu("prepare", { request });
      setPredictionsCsv(json.predictionsCsv || "");
      setRunnerPy(json.runnerPy || "");
      setReadme(json.readme || "");
      clearComparison();
      setRunLog("");
      setMessage(`TPU 실험 패키지를 만들었습니다. shape ${json.count ?? shapeCount}개가 포함되었습니다.`);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function compareMeasurements() {
    if (!predictionsCsv.trim()) {
      setMessage("먼저 TPU 실험 패키지를 만들어 predictions/shapes.csv를 생성하세요.");
      return;
    }
    if (!measurementsCsv.trim()) {
      setMessage("TPU에서 생성한 measurements.csv를 붙여넣거나 업로드하세요.");
      return;
    }
    setBusy(true);
    try {
      const json = await postTpu("compare", { predictionsCsv, measurementsCsv, samplesCsv });
      setRows(json.rows || []);
      setSampleRows(json.sampleRows || []);
      setStats(json.stats || null);
      setComparisonCsv(json.comparisonCsv || "");
      setCalibrationCsv(json.calibrationCsv || "");
      setSampleComparisonCsv(json.sampleComparisonCsv || "");
      setSummaryMd(json.summaryMd || "");
      setRunLog("");
      setMessage(`TPU 실측 ${json.rows?.length ?? 0}개와 raw sample ${json.sampleRows?.length ?? 0}개를 TileForge 예측/순위 관점으로 비교했습니다.`);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function runOnServer() {
    setBusy(true);
    setMessage("");
    try {
      const json = await postTpu("run-server", { request, reps, warmup });
      setPredictionsCsv(json.predictionsCsv || "");
      setMeasurementsCsv(json.measurementsCsv || "");
      setSamplesCsv(json.samplesCsv || "");
      setRows(json.rows || []);
      setSampleRows(json.sampleRows || []);
      setStats(json.stats || null);
      setComparisonCsv(json.comparisonCsv || "");
      setCalibrationCsv(json.calibrationCsv || "");
      setSampleComparisonCsv(json.sampleComparisonCsv || "");
      setSummaryMd(json.summaryMd || "");
      setRunLog(json.log || "");
      setMessage(`서버 TPU 실행과 추천 순위/분포 비교를 완료했습니다. run id: ${json.runId || "n/a"}`);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function readMeasurementFile(file: File | null) {
    if (!file) return;
    setMeasurementsCsv(await file.text());
    setMessage(`${file.name} 파일을 불러왔습니다. tpu_samples.csv도 있으면 함께 업로드한 뒤 비교하세요.`);
  }

  async function readSamplesFile(file: File | null) {
    if (!file) return;
    setSamplesCsv(await file.text());
    setMessage(`${file.name} raw sample 파일을 불러왔습니다. 이제 비교를 실행하세요.`);
  }

  function downloadPackageFiles() {
    if (!predictionsCsv || !runnerPy) {
      setMessage("먼저 TPU 실험 패키지를 만들어 주세요.");
      return;
    }
    download("shapes.csv", predictionsCsv, "text/csv");
    download("run_on_tpu.py", runnerPy, "text/x-python");
    download("README_TPU.txt", readme || "", "text/plain");
  }

  return (
    <section className="artifact-panel" title="현재 TileForge 설정을 실제 TPU JAX microbenchmark와 비교합니다.">
      <h3>TPU 직접 비교</h3>
      <p className="small">
        현재 설정: <strong>{requestLabel}</strong>. 브라우저는 TPU를 직접 소유하지 않으므로 기본 흐름은
        <strong> 실험 파일 생성 → TPU VM 실행 → 측정 CSV 업로드 → 비교 그래프 확인</strong>입니다. 서버가 TPU VM에서 돌고 있으면 바로 실행도 가능합니다.
      </p>

      <div className="report-status-strip">
        <span className={`badge ${webRunEnabled ? "ok-badge" : "warn-badge"}`}>
          {webRunEnabled ? "서버 TPU 실행 가능" : "서버 TPU 실행 비활성"}
        </span>
        <span className="badge">ops {shapeCount}</span>
        {stats && <span className="badge">MAPE {fmt(stats.mapePercent)}%</span>}
        {stats && <span className="badge">ratio {fmt(stats.totalRatio, 3)}</span>}
        {stats?.sampleRows > 0 && <span className="badge">raw samples {stats.sampleRows}</span>}
        {stats?.sampleRows > 0 && <span className="badge">sample MAPE {fmt(stats.sampleMapePercent)}%</span>}
        {stats?.recommendation && <span className={stats.recommendation.top1Hit ? "badge ok-badge" : "badge warn-badge"}>추천 Top-1 {stats.recommendation.top1Hit ? "일치" : "불일치"}</span>}
        {stats?.recommendation && <span className="badge">regret {fmt(stats.recommendation.regretPercent)}%</span>}
      </div>

      <div className="run-actions">
        <ActionButton tip="현재 하드웨어/워크로드 설정으로 shapes.csv와 run_on_tpu.py를 생성합니다." onClick={() => void preparePackage()}>
          1. TPU 실험 파일 만들기
        </ActionButton>
        <button className="secondary" onClick={downloadPackageFiles} disabled={!predictionsCsv} title="shapes.csv, run_on_tpu.py, README_TPU.txt를 각각 다운로드합니다.">
          실험 파일 다운로드
        </button>
        <ActionButton tip="업로드/붙여넣기한 measurements.csv, tpu_samples.csv와 TileForge 예측을 병합하고 분포 그래프를 그립니다." onClick={() => void compareMeasurements()}>
          2. 측정 CSV와 비교 그래프
        </ActionButton>
      </div>

      <div className="run-actions" style={{ marginTop: 8 }}>
        <label className="mini-field" title="서버에서 바로 실행할 때 사용할 반복 횟수입니다. raw sample 그래프의 점 개수와 직접 연결됩니다.">
          <span className="mini-field-label">reps</span>
          <input title="각 shape를 몇 번 반복 측정할지 정합니다." type="number" min={1} max={1000} value={reps} onChange={(e) => setReps(Number(e.target.value))} />
        </label>
        <label className="mini-field" title="서버에서 바로 실행할 때 사용할 warm-up 횟수입니다.">
          <span className="mini-field-label">warmup</span>
          <input title="측정 전에 버릴 warm-up 반복 횟수입니다." type="number" min={0} max={1000} value={warmup} onChange={(e) => setWarmup(Number(e.target.value))} />
        </label>
        <button className="secondary" onClick={() => void runOnServer()} disabled={busy || !webRunEnabled} title="TileForge 서버가 TPU VM에서 실행 중이고 TILEFORGE_ENABLE_TPU_WEB_RUN=1일 때만 동작합니다.">
          서버에서 바로 실행
        </button>
      </div>

      <p className="small">
        TPU VM에서는 다운로드한 파일을 같은 폴더에 두고 <code>python run_on_tpu.py --shapes shapes.csv --out measurements.csv --samples-out tpu_samples.csv</code>를 실행하면 됩니다.
      </p>

      <div className="stacked-fields">
        <label className="field-label" title="TPU VM에서 생성한 measurements.csv를 업로드합니다.">
          <span>TPU measurements.csv 업로드</span>
          <input title="TPU VM에서 생성한 measurements.csv 파일을 선택합니다." type="file" accept=".csv,text/csv" onChange={(e) => void readMeasurementFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="field-label" title="TPU VM에서 --samples-out으로 생성한 raw timing sample CSV를 업로드합니다.">
          <span>TPU tpu_samples.csv 업로드</span>
          <input title="TPU VM에서 생성한 tpu_samples.csv raw timing 파일을 선택합니다." type="file" accept=".csv,text/csv" onChange={(e) => void readSamplesFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="field-label" title="파일 업로드 대신 measurements.csv 원문을 붙여넣어도 됩니다.">
          <span>measurements.csv 원문</span>
          <textarea title="measurements.csv 원문을 직접 붙여넣습니다." value={measurementsCsv} onChange={(e) => setMeasurementsCsv(e.target.value)} rows={6} placeholder="id,model,op_name,m,n,k,median_us,mean_us,min_us,max_us,p90_us,achieved_tflops,reps\n..." />
        </label>
        <label className="field-label" title="파일 업로드 대신 tpu_samples.csv 원문을 붙여넣어도 됩니다. 이 값이 있어야 분포 그래프가 풍부하게 그려집니다.">
          <span>tpu_samples.csv 원문</span>
          <textarea title="tpu_samples.csv 원문을 직접 붙여넣습니다." value={samplesCsv} onChange={(e) => setSamplesCsv(e.target.value)} rows={5} placeholder="id,model,op_name,m,n,k,dtype,rep,measured_us\n..." />
        </label>
      </div>

      {busy && <p className="small">처리 중입니다...</p>}
      {message && <p className="small">{message}</p>}

      {rows.length > 0 && <TpuRecommendationChart rows={rows} />}

      {rows.length > 0 && <TpuDistributionChart rows={rows} sampleRows={sampleRows} />}

      {summaryMd && (
        <div className="artifact-panel" style={{ marginTop: 16 }}>
          <div className="artifact-toolbar">
            <button className="secondary" title="예측 시간과 TPU 측정 시간을 op별로 비교한 CSV를 저장합니다." onClick={() => download("tpu_comparison.csv", comparisonCsv, "text/csv")}>comparison.csv 다운로드</button>
            <button className="secondary" title="TileForge 예측을 TPU 측정값에 맞춰 보정할 때 사용할 calibration CSV를 저장합니다." onClick={() => download("tpu_calibration.csv", calibrationCsv, "text/csv")}>calibration.csv 다운로드</button>
            <button className="secondary" title="반복 측정 raw sample과 예측값을 비교한 CSV를 저장합니다." onClick={() => download("tpu_sample_comparison.csv", sampleComparisonCsv, "text/csv")} disabled={!sampleComparisonCsv}>sample-comparison.csv 다운로드</button>
            <button className="secondary" title="TPU 비교 결과 요약 보고서를 Markdown으로 저장합니다." onClick={() => download("tpu_summary.md", summaryMd, "text/markdown")}>summary.md 다운로드</button>
          </div>
          <MarkdownView text={summaryMd} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                <th>op</th>
                <th>shape</th>
                <th>pred us</th>
                <th>measured us</th>
                <th>ratio</th>
                <th>error %</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((row, index) => (
                <tr key={`${row.id ?? row.opName}-${index}`}>
                  <td>{row.model}.{row.opName}</td>
                  <td>{row.m}x{row.n}x{row.k}</td>
                  <td>{fmt(row.predictedTimeUs)}</td>
                  <td>{fmt(row.measuredUs)}</td>
                  <td>{fmt(row.runtimeRatio, 3)}</td>
                  <td>{fmt(row.errorPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {predictionsCsv && (
        <details className="json-details">
          <summary>생성된 TPU 실험 파일 미리보기</summary>
          <Artifact name="shapes.csv" text={predictionsCsv} download={download} />
          <Artifact name="run_on_tpu.py" text={runnerPy} download={download} />
          <Artifact name="README_TPU.txt" text={readme} download={download} />
        </details>
      )}

      {runLog && (
        <details className="json-details">
          <summary>서버 실행 로그</summary>
          <pre className="pre">{runLog}</pre>
        </details>
      )}
    </section>
  );
}
