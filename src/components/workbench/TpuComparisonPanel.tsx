"use client";

import { useEffect, useMemo, useState } from "react";
import { ActionButton, Artifact, MarkdownView, type DownloadFn } from "./primitives";

function fmt(value: unknown, digits = 2): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

async function postTpu(action: string, body: Record<string, unknown>) {
  const res = await fetch("/api/tpu", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) throw new Error(json?.error || json?.detail || `TPU API failed: ${res.status}`);
  return json;
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
  const [comparisonCsv, setComparisonCsv] = useState("");
  const [calibrationCsv, setCalibrationCsv] = useState("");
  const [summaryMd, setSummaryMd] = useState("");
  const [rows, setRows] = useState<any[]>([]);
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
    fetch("/api/tpu")
      .then((r) => r.json())
      .then((j) => setWebRunEnabled(Boolean(j.webRunEnabled)))
      .catch(() => setWebRunEnabled(false));
  }, []);

  async function preparePackage() {
    setBusy(true);
    setMessage("");
    try {
      const json = await postTpu("prepare", { request });
      setPredictionsCsv(json.predictionsCsv || "");
      setRunnerPy(json.runnerPy || "");
      setReadme(json.readme || "");
      setComparisonCsv("");
      setCalibrationCsv("");
      setSummaryMd("");
      setRows([]);
      setStats(null);
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
      const json = await postTpu("compare", { predictionsCsv, measurementsCsv });
      setRows(json.rows || []);
      setStats(json.stats || null);
      setComparisonCsv(json.comparisonCsv || "");
      setCalibrationCsv(json.calibrationCsv || "");
      setSummaryMd(json.summaryMd || "");
      setRunLog("");
      setMessage(`TPU 실측 ${json.rows?.length ?? 0}개와 TileForge 예측을 비교했습니다.`);
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
      setRows(json.rows || []);
      setStats(json.stats || null);
      setComparisonCsv(json.comparisonCsv || "");
      setCalibrationCsv(json.calibrationCsv || "");
      setSummaryMd(json.summaryMd || "");
      setRunLog(json.log || "");
      setMessage(`서버 TPU 실행과 비교를 완료했습니다. run id: ${json.runId || "n/a"}`);
    } catch (error: any) {
      setMessage(error?.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  async function readMeasurementFile(file: File | null) {
    if (!file) return;
    setMeasurementsCsv(await file.text());
    setMessage(`${file.name} 파일을 불러왔습니다. 이제 비교를 실행하세요.`);
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
        <strong> 실험 파일 생성 → TPU VM 실행 → 측정 CSV 업로드 → 비교</strong>입니다. 이 웹 서버가 TPU VM에서 돌고 있으면 서버 실행도 가능합니다.
      </p>

      <div className="report-status-strip">
        <span className={`badge ${webRunEnabled ? "ok-badge" : "warn-badge"}`}>
          {webRunEnabled ? "서버 TPU 실행 가능" : "서버 TPU 실행 비활성"}
        </span>
        <span className="badge">ops {shapeCount}</span>
        {stats && <span className="badge">MAPE {fmt(stats.mapePercent)}%</span>}
        {stats && <span className="badge">ratio {fmt(stats.totalRatio, 3)}</span>}
      </div>

      <div className="run-actions">
        <ActionButton tip="현재 하드웨어/워크로드 설정으로 shapes.csv와 run_on_tpu.py를 생성합니다." onClick={() => void preparePackage()}>
          1. TPU 실험 파일 만들기
        </ActionButton>
        <button className="secondary" onClick={downloadPackageFiles} disabled={!predictionsCsv} title="shapes.csv, run_on_tpu.py, README_TPU.txt를 각각 다운로드합니다.">
          실험 파일 다운로드
        </button>
        <ActionButton tip="업로드/붙여넣기한 measurements.csv와 TileForge 예측을 병합합니다." onClick={() => void compareMeasurements()}>
          2. 측정 CSV와 비교
        </ActionButton>
      </div>

      <div className="run-actions" style={{ marginTop: 8 }}>
        <label className="mini-field" title="서버에서 바로 실행할 때 사용할 반복 횟수입니다.">
          <span className="mini-field-label">reps</span>
          <input type="number" min={1} max={1000} value={reps} onChange={(e) => setReps(Number(e.target.value))} />
        </label>
        <label className="mini-field" title="서버에서 바로 실행할 때 사용할 warm-up 횟수입니다.">
          <span className="mini-field-label">warmup</span>
          <input type="number" min={0} max={1000} value={warmup} onChange={(e) => setWarmup(Number(e.target.value))} />
        </label>
        <button className="secondary" onClick={() => void runOnServer()} disabled={busy || !webRunEnabled} title="TileForge 서버가 TPU VM에서 실행 중이고 TILEFORGE_ENABLE_TPU_WEB_RUN=1일 때만 동작합니다.">
          서버에서 바로 실행
        </button>
      </div>

      <p className="small">
        TPU VM에서는 다운로드한 파일을 같은 폴더에 두고 <code>python run_on_tpu.py --shapes shapes.csv --out measurements.csv</code>만 실행하면 됩니다.
      </p>

      <div className="stacked-fields">
        <label className="field-label" title="TPU VM에서 생성한 measurements.csv를 업로드합니다.">
          <span>TPU measurements.csv 업로드</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => void readMeasurementFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="field-label" title="파일 업로드 대신 measurements.csv 원문을 붙여넣어도 됩니다.">
          <span>measurements.csv 원문</span>
          <textarea value={measurementsCsv} onChange={(e) => setMeasurementsCsv(e.target.value)} rows={6} placeholder="id,model,op_name,m,n,k,median_us,mean_us,achieved_tflops,reps\n..." />
        </label>
      </div>

      {busy && <p className="small">처리 중입니다...</p>}
      {message && <p className="small">{message}</p>}

      {summaryMd && (
        <div className="artifact-panel" style={{ marginTop: 16 }}>
          <div className="artifact-toolbar">
            <button className="secondary" onClick={() => download("tpu_comparison.csv", comparisonCsv, "text/csv")}>comparison.csv 다운로드</button>
            <button className="secondary" onClick={() => download("tpu_calibration.csv", calibrationCsv, "text/csv")}>calibration.csv 다운로드</button>
            <button className="secondary" onClick={() => download("tpu_summary.md", summaryMd, "text/markdown")}>summary.md 다운로드</button>
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
