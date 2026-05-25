import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateAll } from "../src/lib/estimator";
import { defaultCandidates, defaultHardware } from "../src/lib/defaults";
import { hardwarePresets, workloadPresets } from "../src/lib/presets";
import type { SearchRequest, Dataflow } from "../src/types/domain";

const API = process.env.TILEFORGE_API ?? "http://localhost:3000";
const outDir = path.join(process.cwd(), "profiles");
const profilePath = path.join(outDir, "scalesim-regression-profile.json");

function arg(name: string, fallback?: string) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function requests(): SearchRequest[] {
  const hwNames = (arg("hardware", "TPUv2-like 128x128") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const wlNames = (arg("workload", "ViT-S encoder block,BERT-base seq384 block") ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const dfs = (arg("dataflows", "WS,OS,IS") ?? "WS").split(",").map(s => s.trim()).filter(Boolean) as Dataflow[];
  const hws = hardwarePresets.filter(h => hwNames.includes(h.name));
  const reqs: SearchRequest[] = [];
  for (const hw of (hws.length ? hws : [defaultHardware])) {
    for (const wl of wlNames) {
      const shapes = workloadPresets[wl];
      if (!shapes) continue;
      for (const df of dfs) {
        reqs.push({
          hardware: { ...hw, dataflow: df },
          shapes,
          candidates: defaultCandidates,
          objective: "balanced",
          maxResultsPerOp: 24,
          scaleSim: { runName: "regression", bandwidth: 128, interfaceBandwidth: "USER", useLayout: true, ifmapCustomLayout: false, filterCustomLayout: false, ifmapSRAMBankBandwidth: 10, ifmapSRAMBankNum: 10, ifmapSRAMBankPort: 2, filterSRAMBankBandwidth: 10, filterSRAMBankNum: 10, filterSRAMBankPort: 2 },
        });
      }
    }
  }
  return reqs;
}

async function postJob(request: SearchRequest, index: number) {
  const name = `regression_${request.hardware.name}_${request.hardware.dataflow}_${index}`.replace(/[^A-Za-z0-9_.-]+/g, "_");
  const r = await fetch(`${API}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "full-pipeline", name, request }) });
  if (!r.ok) throw new Error(`enqueue failed ${r.status}: ${await r.text()}`);
  return await r.json();
}

async function readJob(id: string) {
  const r = await fetch(`${API}/api/jobs/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`read job ${id} failed: ${r.status}`);
  return await r.json();
}

async function readArtifact(id: string, artifactPath: string) {
  const r = await fetch(`${API}/api/jobs/${id}/artifact?path=${encodeURIComponent(artifactPath)}`, { cache: "no-store" });
  if (!r.ok) return "";
  return await r.text();
}

function parseScaleCycles(text: string): number | undefined {
  try {
    const j = JSON.parse(text);
    const v = Number(j.totalCycles ?? j.total_cycles ?? j.cycles);
    return Number.isFinite(v) ? v : undefined;
  } catch {
    const m = text.match(/total[^0-9]*(\d[\d,]*)/i);
    return m ? Number(m[1].replace(/,/g, "")) : undefined;
  }
}

function fitMultiplier(samples: Array<{ predicted: number; measured: number }>) {
  let num = 0, den = 0;
  for (const s of samples) { num += s.predicted * s.measured; den += s.predicted * s.predicted; }
  const factor = den ? num / den : 1;
  const errors = samples.map(s => (s.predicted * factor - s.measured) / Math.max(1, s.measured));
  const mae = errors.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, errors.length);
  const rmse = Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / Math.max(1, errors.length));
  return { factor, maePct: mae * 100, rmsePct: rmse * 100 };
}

async function main() {
  const mode = arg("mode", "enqueue-wait-fit") ?? "enqueue-wait-fit";
  const reqs = requests();
  if (!reqs.length) throw new Error("no regression requests selected");
  const jobs: any[] = [];
  if (mode.includes("enqueue")) {
    for (let i = 0; i < reqs.length; i++) {
      const job = await postJob(reqs[i], i);
      console.log(`[regression] enqueued ${job.name ?? job.id}`);
      jobs.push({ id: job.id, request: reqs[i] });
    }
  }
  if (mode.includes("wait")) {
    const timeoutMs = Number(arg("timeout-ms", "1800000"));
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const states = await Promise.all(jobs.map(j => readJob(j.id).catch(() => null)));
      const done = states.filter(Boolean).filter((j: any) => ["succeeded", "succeeded_with_warnings", "failed", "cancelled"].includes(j.status)).length;
      process.stdout.write(`\r[regression] completed ${done}/${jobs.length}`);
      if (done === jobs.length) { console.log(); break; }
      await sleep(3000);
    }
  }
  const samples: any[] = [];
  for (const item of jobs) {
    const job = await readJob(item.id).catch(() => null);
    if (!job || !["succeeded", "succeeded_with_warnings"].includes(job.status)) continue;
    const predicted = estimateAll(item.request).summary.totalCycles;
    const txt = await readArtifact(item.id, "scalesim_summary.json");
    const measured = parseScaleCycles(txt);
    if (!measured) continue;
    samples.push({ id: item.id, name: job.name, hardware: item.request.hardware.name, dataflow: item.request.hardware.dataflow, predicted, measured, ratio: measured / Math.max(1, predicted) });
  }
  const fit = fitMultiplier(samples);
  await mkdir(outDir, { recursive: true });
  const profile = { kind: "tileforge-scalesim-regression", createdAt: new Date().toISOString(), api: API, samples, fit, note: "Apply factor to estimator total cycles as a first-order calibration. Re-run when SCALE-Sim version, layout policy, or hardware preset changes." };
  await writeFile(profilePath, JSON.stringify(profile, null, 2), "utf8");
  console.log(`[regression] samples=${samples.length}, factor=${fit.factor.toFixed(4)}, MAE=${fit.maePct.toFixed(2)}%, RMSE=${fit.rmsePct.toFixed(2)}%`);
  console.log(`[regression] wrote ${profilePath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
