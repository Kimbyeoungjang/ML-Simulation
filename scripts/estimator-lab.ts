import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateTile } from "../src/lib/estimator";
import { defaultCandidates, defaultHardware, defaultShapes } from "../src/lib/defaults";
import { evaluateLearnedEstimator, predictLearnedCycles, trainLearnedEstimator, type LearnedEstimatorModel, type LearnedEstimatorSample } from "../src/lib/learnedEstimator";
import { compareResidualEstimators, evaluateNeuralResidualEstimator, predictionRowsForComparison, predictNeuralCycles, trainNeuralResidualEstimator, type NeuralResidualEstimatorModel } from "../src/lib/neuralResidualEstimator";
import { estimatorSuitePredictionRows, summarizeSuiteValidation, trainEstimatorSuite, type EstimatorSuiteModel } from "../src/lib/estimatorSuite";
import type { Dataflow, HardwareConfig, MatmulShape } from "../src/types/domain";

function arg(name: string, fallback?: string) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}
function has(name: string) { return process.argv.includes(`--${name}`); }
function splitNums(v: string | undefined, fallback: number[]) { return (v ?? fallback.join(",")).split(/[, ]+/).map(Number).filter(Number.isFinite); }
function splitStr(v: string | undefined, fallback: string[]) { return (v ?? fallback.join(",")).split(/[, ]+/).map(s => s.trim()).filter(Boolean); }
function csvEscape(v: unknown) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function parseCsvLine(line: string) {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}
function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [] as Record<string, string>[];
  const header = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}
function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const header = Object.keys(rows[0]);
  return [header.join(","), ...rows.map(r => header.map(h => csvEscape(r[h])).join(","))].join("\n") + "\n";
}
function num(row: Record<string, string>, names: string[], fallback = NaN) {
  for (const n of names) {
    const v = Number(row[n]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}
function str(row: Record<string, string>, names: string[], fallback = "") {
  for (const n of names) if (row[n]) return row[n];
  return fallback;
}
function sampleFromRow(row: Record<string, string>): LearnedEstimatorSample | undefined {
  const measuredCycles = num(row, ["measuredCycles", "scaleSimCycles", "scalesimCycles", "totalCycles", "cycles_measured", "measured_cycles"]);
  const estimatorCycles = num(row, ["estimatorCycles", "predictedCycles", "tileforgeCycles", "cycles_estimator", "predicted_cycles"]);
  const m = num(row, ["m", "M"]), n = num(row, ["n", "N"]), k = num(row, ["k", "K"]);
  const tileM = num(row, ["tileM", "tm", "tile_m"]), tileN = num(row, ["tileN", "tn", "tile_n"]), tileK = num(row, ["tileK", "tk", "tile_k"]);
  if (![measuredCycles, estimatorCycles, m, n, k, tileM, tileN, tileK].every(v => Number.isFinite(v) && v > 0)) return undefined;
  return {
    id: str(row, ["id", "sampleId"], ""),
    model: str(row, ["model"], "csv"),
    opName: str(row, ["opName", "op_name", "layer"], "op"),
    arrayRows: num(row, ["arrayRows", "array_rows"], defaultHardware.arrayRows),
    arrayCols: num(row, ["arrayCols", "array_cols"], defaultHardware.arrayCols),
    sramKB: num(row, ["sramKB", "sram_kb"], defaultHardware.sramKB),
    frequencyMHz: num(row, ["frequencyMHz", "freqMHz", "frequency_mhz"], defaultHardware.frequencyMHz),
    dataflow: str(row, ["dataflow"], defaultHardware.dataflow),
    dtypeBytes: num(row, ["dtypeBytes", "dtype_bytes"], 2),
    m, n, k, tileM, tileN, tileK, estimatorCycles, measuredCycles
  };
}
async function loadSamples(file: string) {
  const text = await readFile(file, "utf8");
  return parseCsv(text).map(sampleFromRow).filter(Boolean) as LearnedEstimatorSample[];
}
function hardwareGrid(): HardwareConfig[] {
  const arrays = splitStr(arg("arrays", "32x32,64x64,128x128,128x256,256x128,256x256"), []);
  const sram = splitNums(arg("sram-kb", "2048,4096,8192,16384"), []);
  const dfs = splitStr(arg("dataflows", "WS,OS,IS"), []) as Dataflow[];
  const out: HardwareConfig[] = [];
  for (const a of arrays) {
    const [rows, cols] = a.toLowerCase().split("x").map(Number);
    if (!Number.isFinite(rows) || !Number.isFinite(cols)) continue;
    for (const sramKB of sram) for (const dataflow of dfs) out.push({ ...defaultHardware, name: `${rows}x${cols}_${sramKB}KB_${dataflow}`, arrayRows: rows, arrayCols: cols, sramKB, dataflow });
  }
  return out;
}
function syntheticShapes(): MatmulShape[] {
  const ms = splitNums(arg("m", "64,128,197,256,384,512,1024,2048"), []);
  const ns = splitNums(arg("n", "64,128,256,384,768,1024,1536,2304,4096"), []);
  const ks = splitNums(arg("k", "64,128,256,384,768,1024,1536,4096"), []);
  const limit = Number(arg("shape-limit", "256"));
  const shapes: MatmulShape[] = [...defaultShapes];
  let id = 0;
  outer: for (const m of ms) for (const n of ns) for (const k of ks) {
    shapes.push({ id: `doe_${id++}`, model: "doe", opName: `gemm_${m}x${n}x${k}`, m, n, k, dtypeBytes: 2, source: "manual" });
    if (shapes.length >= limit) break outer;
  }
  return shapes;
}
async function design() {
  const out = arg("out", "profiles/estimator-lab/design.csv")!;
  const topK = Number(arg("topk", "8"));
  const rows: Record<string, unknown>[] = [];
  for (const hw of hardwareGrid()) {
    for (const shape of syntheticShapes()) {
      const candidates = [];
      for (const tileM of defaultCandidates.tileM) for (const tileN of defaultCandidates.tileN) for (const tileK of defaultCandidates.tileK) {
        const t = estimateTile(hw, shape, tileM, tileN, tileK, "balanced");
        candidates.push(t);
      }
      candidates.sort((a, b) => a.score - b.score);
      for (const tile of candidates.slice(0, topK)) {
        rows.push({
          id: `${hw.name}_${shape.id}_${tile.tileM}x${tile.tileN}x${tile.tileK}`,
          model: shape.model,
          opName: shape.opName,
          arrayRows: hw.arrayRows,
          arrayCols: hw.arrayCols,
          sramKB: hw.sramKB,
          frequencyMHz: hw.frequencyMHz,
          dataflow: hw.dataflow,
          dtypeBytes: shape.dtypeBytes,
          m: shape.m,
          n: shape.n,
          k: shape.k,
          tileM: tile.tileM,
          tileN: tile.tileN,
          tileK: tile.tileK,
          estimatorCycles: tile.cycles,
          measuredCycles: "",
          scaleSimRunName: `lab_${rows.length}`
        });
      }
    }
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, toCsv(rows), "utf8");
  console.log(`[estimator-lab] wrote design CSV: ${out} (${rows.length} planned simulations)`);
  console.log(`[estimator-lab] fill measuredCycles from SCALE-Sim COMPUTE_REPORT results, then run: npm run estimator:train -- --input ${out}`);
}
async function train() {
  const input = arg("input", "profiles/estimator-lab/results.csv")!;
  const out = arg("out", "profiles/learned-estimator-model.json")!;
  const report = arg("report", "profiles/learned-estimator-report.md")!;
  const samples = await loadSamples(input);
  const model = trainLearnedEstimator(samples, {
    trees: Number(arg("trees", "128")),
    maxDepth: Number(arg("max-depth", "10")),
    minLeaf: Number(arg("min-leaf", "4")),
    seed: Number(arg("seed", "42")),
    validationFraction: Number(arg("validation", "0.2"))
  });
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(model, null, 2), "utf8");
  const m = model.validation;
  const md = [`# TileForge Learned Estimator Report`, ``, `- Samples: ${model.metadata.samples}`, `- Train / validation: ${model.metadata.trainSamples} / ${model.metadata.validationSamples}`, `- Trees: ${model.metadata.trees}`, `- Max depth: ${model.metadata.maxDepth}`, `- Min leaf: ${model.metadata.minLeaf}`, ``, `## Validation`, ``, `| Metric | Baseline estimator | Learned estimator |`, `|---|---:|---:|`, `| MAPE | ${m?.baselineMapePct.toFixed(2)}% | ${m?.learnedMapePct.toFixed(2)}% |`, `| RMSE | ${m?.baselineRmsePct.toFixed(2)}% | ${m?.learnedRmsePct.toFixed(2)}% |`, ``, `Learned absolute error percentiles: P50=${m?.p50AbsPct.toFixed(2)}%, P90=${m?.p90AbsPct.toFixed(2)}%, P95=${m?.p95AbsPct.toFixed(2)}%.`, ``, `## Usage`, ``, `Use \`predictCycleFactor(model, sample)\` or \`learnedEstimateTile(model, hw, shape, tileM, tileN, tileK, objective)\` from \`src/lib/learnedEstimator.ts\`.`].join("\n");
  await writeFile(report, md, "utf8");
  console.log(`[estimator-lab] samples=${model.metadata.samples}, baseline MAPE=${m?.baselineMapePct.toFixed(2)}%, learned MAPE=${m?.learnedMapePct.toFixed(2)}%`);
  console.log(`[estimator-lab] wrote ${out}`);
  console.log(`[estimator-lab] wrote ${report}`);
}
async function evaluate() {
  const input = arg("input", "profiles/estimator-lab/results.csv")!;
  const modelPath = arg("model", "profiles/learned-estimator-model.json")!;
  const samples = await loadSamples(input);
  const model = JSON.parse(await readFile(modelPath, "utf8")) as LearnedEstimatorModel;
  const metrics = evaluateLearnedEstimator(model, samples);
  console.log(JSON.stringify(metrics, null, 2));
  if (has("predictions")) {
    const out = arg("out", "profiles/estimator-lab/predictions.csv")!;
    const rows = samples.map(s => ({ ...s, learnedCycles: predictLearnedCycles(model, s), learnedFactor: predictLearnedCycles(model, s) / s.estimatorCycles }));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, toCsv(rows as unknown as Record<string, unknown>[]), "utf8");
    console.log(`[estimator-lab] wrote predictions: ${out}`);
  }
}
async function trainNeural() {
  const input = arg("input", "profiles/estimator-lab/results.csv")!;
  const out = arg("out", "profiles/neural-residual-estimator-model.json")!;
  const report = arg("report", "profiles/neural-residual-estimator-report.md")!;
  const samples = await loadSamples(input);
  const model = trainNeuralResidualEstimator(samples, {
    hiddenUnits: Number(arg("hidden", "16")),
    epochs: Number(arg("epochs", "700")),
    learningRate: Number(arg("learning-rate", "0.015")),
    l2: Number(arg("l2", "0.0001")),
    seed: Number(arg("seed", "42")),
    validationFraction: Number(arg("validation", "0.2"))
  });
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(model, null, 2), "utf8");
  const m = model.validation;
  const md = [`# TileForge Neural Residual Estimator Report`, ``, `- Samples: ${model.metadata.samples}`, `- Train / validation: ${model.metadata.trainSamples} / ${model.metadata.validationSamples}`, `- Hidden units: ${model.hiddenUnits}`, `- Epochs: ${model.metadata.epochs}`, `- Learning rate: ${model.metadata.learningRate}`, `- L2: ${model.metadata.l2}`, ``, `## Validation`, ``, `| Metric | Baseline estimator | Neural residual estimator |`, `|---|---:|---:|`, `| MAPE | ${m?.baselineMapePct.toFixed(2)}% | ${m?.learnedMapePct.toFixed(2)}% |`, `| RMSE | ${m?.baselineRmsePct.toFixed(2)}% | ${m?.learnedRmsePct.toFixed(2)}% |`, ``, `Neural absolute error percentiles: P50=${m?.p50AbsPct.toFixed(2)}%, P90=${m?.p90AbsPct.toFixed(2)}%, P95=${m?.p95AbsPct.toFixed(2)}%.`, ``, `주의: 이 모델은 딥러닝 비교 baseline입니다. 현재 데이터가 작거나 workload 분포가 좁으면 tree residual 모델을 기본값으로 쓰는 편이 안전합니다.`].join("\n");
  await writeFile(report, md, "utf8");
  console.log(`[estimator-lab] neural samples=${model.metadata.samples}, baseline MAPE=${m?.baselineMapePct.toFixed(2)}%, neural MAPE=${m?.learnedMapePct.toFixed(2)}%`);
  console.log(`[estimator-lab] wrote ${out}`);
  console.log(`[estimator-lab] wrote ${report}`);
}

async function evaluateNeural() {
  const input = arg("input", "profiles/estimator-lab/results.csv")!;
  const modelPath = arg("model", "profiles/neural-residual-estimator-model.json")!;
  const samples = await loadSamples(input);
  const model = JSON.parse(await readFile(modelPath, "utf8")) as NeuralResidualEstimatorModel;
  const metrics = evaluateNeuralResidualEstimator(model, samples);
  console.log(JSON.stringify(metrics, null, 2));
  if (has("predictions")) {
    const out = arg("out", "profiles/estimator-lab/neural-predictions.csv")!;
    const rows = samples.map(s => ({ ...s, neuralCycles: predictNeuralCycles(model, s), neuralFactor: predictNeuralCycles(model, s) / s.estimatorCycles }));
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, toCsv(rows as unknown as Record<string, unknown>[]), "utf8");
    console.log(`[estimator-lab] wrote neural predictions: ${out}`);
  }
}

async function compare() {
  const input = arg("input", "profiles/estimator-lab/results.csv")!;
  const outDir = arg("out-dir", "profiles/estimator-lab")!;
  const samples = await loadSamples(input);
  const result = compareResidualEstimators(samples, {
    trees: Number(arg("trees", "128")),
    maxDepth: Number(arg("max-depth", "10")),
    minLeaf: Number(arg("min-leaf", "4")),
    hiddenUnits: Number(arg("hidden", "16")),
    epochs: Number(arg("epochs", "700")),
    learningRate: Number(arg("learning-rate", "0.015")),
    l2: Number(arg("l2", "0.0001")),
    seed: Number(arg("seed", "42")),
    validationFraction: Number(arg("validation", "0.2"))
  });
  await mkdir(outDir, { recursive: true });
  const treePath = path.join(outDir, "tree-residual-model.json");
  const neuralPath = path.join(outDir, "neural-residual-model.json");
  const predictionsPath = path.join(outDir, "estimator-comparison-predictions.csv");
  const reportPath = path.join(outDir, "estimator-comparison-report.md");
  await writeFile(treePath, JSON.stringify(result.tree, null, 2), "utf8");
  await writeFile(neuralPath, JSON.stringify(result.neural, null, 2), "utf8");
  await writeFile(predictionsPath, toCsv(predictionRowsForComparison(samples, result.tree, result.neural) as unknown as Record<string, unknown>[]), "utf8");
  const md = [`# TileForge Estimator Model Comparison`, ``, `추천 모델: **${result.recommendation}**`, ``, result.reason, ``, `## Error summary`, ``, `| Model | MAPE | RMSE | P50 abs. | P90 abs. | P95 abs. |`, `|---|---:|---:|---:|---:|---:|`, `| Baseline analytical estimator | ${result.treeMetrics.baselineMapePct.toFixed(2)}% | ${result.treeMetrics.baselineRmsePct.toFixed(2)}% | - | - | - |`, `| Tree residual estimator | ${result.treeMetrics.learnedMapePct.toFixed(2)}% | ${result.treeMetrics.learnedRmsePct.toFixed(2)}% | ${result.treeMetrics.p50AbsPct.toFixed(2)}% | ${result.treeMetrics.p90AbsPct.toFixed(2)}% | ${result.treeMetrics.p95AbsPct.toFixed(2)}% |`, `| Neural residual estimator | ${result.neuralMetrics.learnedMapePct.toFixed(2)}% | ${result.neuralMetrics.learnedRmsePct.toFixed(2)}% | ${result.neuralMetrics.p50AbsPct.toFixed(2)}% | ${result.neuralMetrics.p90AbsPct.toFixed(2)}% | ${result.neuralMetrics.p95AbsPct.toFixed(2)}% |`, ``, `## Interpretation`, ``, `- Tree residual은 작은/중간 규모 SCALE-Sim 데이터에서 기본값으로 쓰기 좋습니다.`, `- Neural residual은 데이터가 충분히 많고 workload가 다양할 때 비교 실험용으로 켭니다.`, `- 두 모델 모두 전체 cycle을 직접 맞추지 않고 \`log(measuredCycles / estimatorCycles)\`를 예측하므로, 기존 분석 estimator의 물리적 의미를 유지합니다.`, ``, `## Outputs`, ``, `- Tree model: ${treePath}`, `- Neural model: ${neuralPath}`, `- Per-sample predictions: ${predictionsPath}`].join("\n");
  await writeFile(reportPath, md, "utf8");
  console.log(`[estimator-lab] recommendation=${result.recommendation}`);
  console.log(`[estimator-lab] tree MAPE=${result.treeMetrics.learnedMapePct.toFixed(2)}%, neural MAPE=${result.neuralMetrics.learnedMapePct.toFixed(2)}%`);
  console.log(`[estimator-lab] wrote ${reportPath}`);
}

async function suite() {
  const input = arg("input", "profiles/estimator-lab/results.csv")!;
  const outDir = arg("out-dir", "profiles/estimator-lab")!;
  const samples = await loadSamples(input);
  const splitKinds = splitStr(arg("splits", "random,workload,array,dataflow,large-shape"), []) as Array<"random" | "workload" | "array" | "dataflow" | "large-shape">;
  const model = trainEstimatorSuite(samples, {
    trees: Number(arg("trees", "160")),
    maxDepth: Number(arg("max-depth", "10")),
    minLeaf: Number(arg("min-leaf", "4")),
    hiddenUnits: Number(arg("hidden", "64")),
    epochs: Number(arg("epochs", "900")),
    learningRate: Number(arg("learning-rate", "0.01")),
    l2: Number(arg("l2", "0.0001")),
    seed: Number(arg("seed", "42")),
    validationFraction: Number(arg("validation", "0.2")),
    maxSplitTrainSamples: Number(arg("max-split-train", "12000")),
    maxFinalTrainSamples: Number(arg("max-final-train", "20000")),
    splitKinds
  });
  await mkdir(outDir, { recursive: true });
  const suitePath = path.join(outDir, "estimator-suite-model.json");
  const treePath = path.join(outDir, "suite-tree-residual-model.json");
  const neuralPath = path.join(outDir, "suite-neural-residual-model.json");
  const validationPath = path.join(outDir, "estimator-suite-validation.csv");
  const predictionsPath = path.join(outDir, "estimator-suite-predictions.csv");
  const reportPath = path.join(outDir, "estimator-suite-report.md");
  await writeFile(suitePath, JSON.stringify(model, null, 2), "utf8");
  await writeFile(treePath, JSON.stringify(model.tree, null, 2), "utf8");
  await writeFile(neuralPath, JSON.stringify(model.neural, null, 2), "utf8");
  await writeFile(validationPath, toCsv(summarizeSuiteValidation(model) as unknown as Record<string, unknown>[]), "utf8");
  await writeFile(predictionsPath, toCsv(estimatorSuitePredictionRows(samples, model) as unknown as Record<string, unknown>[]), "utf8");
  const rows = model.validationSuite;
  const metricRows = rows.map(r => `| ${r.kind} | ${r.testSamples} | ${r.baseline.learnedMapePct.toFixed(2)}% | ${r.tree.learnedMapePct.toFixed(2)}% | ${r.neural.learnedMapePct.toFixed(2)}% | ${r.ensemble.learnedMapePct.toFixed(2)}% | ${r.ensemble.p90AbsPct.toFixed(2)}% | ${r.recommended} |`).join("\n");
  const md = [
    `# TileForge Estimator Suite Report`,
    ``,
    `추천 최종 모델: **${model.recommended}**`,
    ``,
    `이 suite는 cycle 자체를 바로 학습하지 않고, 기존 analytical estimator의 \`log(measuredCycles / estimatorCycles)\` residual을 Tree와 Neural 모델이 각각 학습한 뒤 validation 성능으로 ensemble weight를 정합니다.`,
    ``,
    `## Final ensemble weights`,
    ``,
    `| Component | Weight |`,
    `|---|---:|`,
    `| Analytical baseline | ${model.weights.analytical.toFixed(4)} |`,
    `| Tree residual | ${model.weights.tree.toFixed(4)} |`,
    `| Neural residual | ${model.weights.neural.toFixed(4)} |`,
    ``,
    `## Holdout validation`,
    ``,
    `| Split | Test samples | Analytical MAPE | Tree MAPE | Neural MAPE | Ensemble MAPE | Ensemble P90 | Best |`,
    `|---|---:|---:|---:|---:|---:|---:|---|`,
    metricRows || `| n/a | 0 | - | - | - | - | - | - |`,
    ``,
    `## Output files`,
    ``,
    `- Suite model: ${suitePath}`,
    `- Tree model: ${treePath}`,
    `- Neural model: ${neuralPath}`,
    `- Validation table: ${validationPath}`,
    `- Per-sample predictions: ${predictionsPath}`,
    ``,
    `## Recommended use`,
    ``,
    `- 수천 개 이하 데이터: Tree residual 중심으로 사용`,
    `- 수만 개 이상 데이터: Neural residual과 Ensemble을 같이 평가`,
    `- 실제 보고서에는 random split만 쓰지 말고 workload/array/dataflow/large-shape holdout을 함께 제시`
  ].join("\n");
  await writeFile(reportPath, md, "utf8");
  console.log(`[estimator-lab] suite recommendation=${model.recommended}`);
  console.log(`[estimator-lab] weights analytical=${model.weights.analytical.toFixed(3)}, tree=${model.weights.tree.toFixed(3)}, neural=${model.weights.neural.toFixed(3)}`);
  console.log(`[estimator-lab] wrote ${reportPath}`);
}

async function main() {
  const cmd = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "design";
  if (cmd === "design") return design();
  if (cmd === "train") return train();
  if (cmd === "evaluate") return evaluate();
  if (cmd === "train-neural") return trainNeural();
  if (cmd === "evaluate-neural") return evaluateNeural();
  if (cmd === "compare") return compare();
  if (cmd === "suite") return suite();
  throw new Error(`unknown estimator-lab command: ${cmd}`);
}
main().catch(e => { console.error(e); process.exit(1); });
