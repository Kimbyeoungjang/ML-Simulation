import type { SearchResponse } from "@/types/domain";
import { shapesToCsv } from "./csv";
import { generateIreeCommand } from "./ireeCommand";
import { latexPolicyTable, summarySvg } from "./paperExport";
import { comparisonCsv, compareExperiments } from "./experiment";
import { hardwarePresets } from "./presets";
import { buildValidationReport } from "./verification";
import { buildRobustPolicy } from "./clustering";
import { compareDataflows, dataflowComparisonCsv } from "./dataflow";
import { memoryTrafficFor, memoryTrafficCsv } from "./memoryTraffic";
import { pruneTileCandidates, compactPruneReport } from "./pruning";
import { tileScheduleSvg } from "./scheduleViz";
import { buildCompilerHints, compilerHintsMarkdown } from "./compilerHints";
import { buildHardwareDesignPlan, hardwareDesignPlanMarkdown } from "./hardwareDesignPlan";
import { buildIreeBenchmarkPlan, ireeBenchmarkPlanMarkdown } from "./ireeBenchmarkPlan";
import { buildPredictionContract } from "./predictionContract";
import { buildTilingStrategyReport, tilingStrategyMarkdown } from "./tilingStrategy";

export function generateArtifacts(res: Omit<SearchResponse, "artifacts"> & { artifacts?: any }) {
  const policyCsv = generatePolicyCsv(res as SearchResponse);
  const mlir = generateMlir(res as SearchResponse);
  const transformDialect = generateTransformDialect(res as SearchResponse);
  const scaleSimConfig = generateScaleSimConfig(res as SearchResponse);
  const scaleSimTopology = generateScaleSimTopology(res as SearchResponse);
  const scaleSimLayout = generateScaleSimLayout(res as SearchResponse);
  const scaleSimTopkTopology = generateScaleSimTopkTopology(res as SearchResponse);
  const scaleSimTopkLayout = generateScaleSimTopkLayout(res as SearchResponse);
  const projectJson = JSON.stringify({ version: "0.5.0", name: res.request.hardware.name, createdAt: new Date().toISOString(), hardware: res.request.hardware, shapes: res.request.shapes, candidates: res.request.candidates, objective: res.request.objective, scaleSim: res.request.scaleSim }, null, 2);
  const manifestJson = JSON.stringify({ tileforgeVersion: "0.5.0-workbench", createdAt: new Date().toISOString(), hardware: res.request.hardware, shapes: res.request.shapes, candidates: res.request.candidates, objective: res.request.objective, scaleSim: res.request.scaleSim, summary: res.summary }, null, 2);
  const ireeCommand = generateIreeCommand("llvm-cpu", "generated.mlir", "transform.mlir", "model.vmfb", res.request.hardware);
  const latexTable = latexPolicyTable(res as SearchResponse);
  const svgSummary = summarySvg(res as SearchResponse);
  const experimentComparisonCsv = comparisonCsv(compareExperiments(res.request, hardwarePresets));
  const validation = buildValidationReport(res as SearchResponse, []);
  const robust = buildRobustPolicy(res as SearchResponse);
  const dfRows = compareDataflows(res.request.hardware, res.request.shapes, res.request.candidates, res.request.objective);
  const dataflowCsv = dataflowComparisonCsv(dfRows);
  const trafficRows = res.results.map(r => memoryTrafficFor(res.request.hardware, r.shape, r.best));
  const trafficCsv = memoryTrafficCsv(trafficRows);
  const first = res.results[0];
  const prune = first ? compactPruneReport(pruneTileCandidates(res.request.hardware, first.shape, res.request.candidates)) : "shape가 없습니다";
  const scheduleSvg = first ? tileScheduleSvg(res.request.hardware, first.shape, first.best) : "";
  const compilerHints = buildCompilerHints(res as SearchResponse);
  const ireeBenchmarkPlan = buildIreeBenchmarkPlan(res as SearchResponse);
  const hardwareDesignPlan = buildHardwareDesignPlan(res as SearchResponse);
  const tilingStrategy = buildTilingStrategyReport(res as SearchResponse);
  const predictionContract = buildPredictionContract(res as SearchResponse);
  return {
    policyCsv,
    mlir,
    transformDialect,
    reportMarkdown: "",
    scaleSimConfig,
    scaleSimTopology,
    scaleSimLayout,
    scaleSimTopkTopology,
    scaleSimTopkLayout,
    projectJson,
    manifestJson,
    ireeCommand,
    latexTable,
    svgSummary,
    experimentComparisonCsv,
    validationMarkdown: validation.markdown,
    validationCsv: validation.csv,
    robustPolicyMarkdown: robust.markdown,
    robustPolicyCsv: robust.csv,
    dataflowComparisonCsv: dataflowCsv,
    memoryTrafficCsv: trafficCsv,
    pruneReportMarkdown: prune,
    tileScheduleSvg: scheduleSvg,
    compilerHintsJson: JSON.stringify(compilerHints, null, 2),
    compilerHintsMarkdown: compilerHintsMarkdown(compilerHints),
    ireeBenchmarkPlanJson: JSON.stringify(ireeBenchmarkPlan, null, 2),
    ireeBenchmarkPlanMarkdown: ireeBenchmarkPlanMarkdown(ireeBenchmarkPlan),
    hardwareDesignPlanJson: JSON.stringify(hardwareDesignPlan, null, 2),
    hardwareDesignPlanMarkdown: hardwareDesignPlanMarkdown(hardwareDesignPlan),
    tilingStrategyJson: JSON.stringify(tilingStrategy, null, 2),
    tilingStrategyMarkdown: tilingStrategyMarkdown(tilingStrategy),
    predictionContractJson: JSON.stringify(predictionContract, null, 2),
  };
}
export function generatePolicyCsv(res: SearchResponse): string {
  const rows = ["모델(model),연산(op_name),M,N,K,배열_rows(array_rows),배열_cols(array_cols),데이터플로우(dataflow),타일_M(tile_m),타일_N(tile_n),타일_K(tile_k),tileM,tileN,tileK,사이클(cycles),full_layer_cycles,tile_policy_cycles,시간_us(time_us),PE_사용률(utilization),패딩_비율(padding_ratio),SRAM_bytes,tile_scratch_bytes,full_layer_working_set_bytes,점수(score),경고(warnings),설명(explanation)"];
  for (const r of res.results) {
    const b = r.best, s = r.shape, h = res.request.hardware;
    rows.push([s.model,s.opName,s.m,s.n,s.k,h.arrayRows,h.arrayCols,h.dataflow,b.tileM,b.tileN,b.tileK,b.tileM,b.tileN,b.tileK,b.cycles,b.fullLayerCycles ?? b.cycles,b.tilePolicyCycles ?? b.cycles,b.timeUs.toFixed(4),b.utilization.toFixed(6),b.paddingRatio.toFixed(6),b.sramBytes,b.tileScratchBytes ?? b.sramBytes,b.fullLayerSramBytes ?? b.sramBytes,b.score.toFixed(6),`"${b.warnings.join("; ")}"`,`"${b.explanation.replaceAll('"','""')}"`].join(","));
  }
  return rows.join("\n");
}
export function generateMlir(res: SearchResponse): string {
  const lines: string[] = [];
  lines.push("// TileForge가 생성한 MLIR 스케치");
  lines.push("// 이 파일은 보수적인 lowering-config 참고용 template입니다.");
  lines.push("module {");
  for (const r of res.results) {
    const s = r.shape, b = r.best;
    const func = sanitize(`${s.model}_${s.opName}`);
    lines.push(`  func.func @${func}(%A: tensor<${s.m}x${s.k}xf32>, %B: tensor<${s.k}x${s.n}xf32>) -> tensor<${s.m}x${s.n}xf32> {`);
    lines.push(`    %C0 = tensor.empty() : tensor<${s.m}x${s.n}xf32>`);
    lines.push(`    // tile = [${b.tileM}, ${b.tileN}, ${b.tileK}], cycles=${b.cycles}, util=${(b.utilization*100).toFixed(1)}%`);
    lines.push(`    // IREE lowering-config 참고: workgroup=[${b.tileM}, ${b.tileN}, 0], reduction=[0, 0, ${b.tileK}]`);
    lines.push(`    %C = linalg.matmul ins(%A, %B : tensor<${s.m}x${s.k}xf32>, tensor<${s.k}x${s.n}xf32>) outs(%C0 : tensor<${s.m}x${s.n}xf32>) -> tensor<${s.m}x${s.n}xf32>`);
    lines.push(`    return %C : tensor<${s.m}x${s.n}xf32>`);
    lines.push("  }");
  }
  lines.push("}");
  return lines.join("\n");
}
export function generateTransformDialect(res: SearchResponse): string {
  const lines: string[] = [];
  lines.push("// TileForge Transform Dialect 스케치");
  lines.push("// 사용하는 IREE/MLIR 버전에 맞게 op 이름과 handle을 조정하세요.");
  lines.push("transform.sequence failures(propagate) {");
  lines.push("^bb0(%root: !transform.any_op):");
  res.results.forEach((r, i) => {
    const b = r.best;
    lines.push(`  // ${r.shape.model}.${r.shape.opName}: ${b.explanation}`);
    lines.push(`  %matmul${i} = transform.structured.match ops{["linalg.matmul"]} in %root : (!transform.any_op) -> !transform.any_op`);
    lines.push(`  %tiled${i}, %loops${i}:3 = transform.structured.tile_using_for %matmul${i} [${b.tileM}, ${b.tileN}, ${b.tileK}] : (!transform.any_op) -> (!transform.any_op, !transform.any_op, !transform.any_op, !transform.any_op)`);
  });
  lines.push("}");
  return lines.join("\n");
}
export function generateScaleSimConfig(res: SearchResponse): string {
  const h = res.request.hardware;
  const sc = res.request.scaleSim ?? {};
  const perBufferKb = Math.max(1, Math.floor(h.sramKB / 3));
  const bool = (v: boolean | undefined, fallback = false) => (v ?? fallback) ? "True" : "False";
  const positiveInt = (v: unknown, fallback: number) => Math.max(1, Math.round(Number(v ?? fallback)));
  const lines = [
    "[general]",
    `run_name = ${sc.runName ?? "tileforge_generated"}`,
    "[architecture_presets]",
    `ArrayHeight = ${h.arrayRows}`,
    `ArrayWidth = ${h.arrayCols}`,
    `IfmapSramSzkB = ${Math.max(1, Math.floor(sc.ifmapSramKB ?? perBufferKb))}`,
    `FilterSramSzkB = ${Math.max(1, Math.floor(sc.filterSramKB ?? perBufferKb))}`,
    `OfmapSramSzkB = ${Math.max(1, Math.floor(sc.ofmapSramKB ?? perBufferKb))}`,
    `IfmapOffset = ${Math.max(0, Math.floor(sc.ifmapOffset ?? 0))}`,
    `FilterOffset = ${Math.max(0, Math.floor(sc.filterOffset ?? 10000000))}`,
    `OfmapOffset = ${Math.max(0, Math.floor(sc.ofmapOffset ?? 20000000))}`,
    `Dataflow = ${String(sc.dataflow ?? h.dataflow).toLowerCase()}`,
    `Bandwidth = ${positiveInt(sc.dramBandwidth ?? sc.bandwidth, 128)}`,
    "[run_presets]",
    `InterfaceBandwidth = ${sc.interfaceBandwidth ?? "USER"}`,
  ];
  // The SCALE-Sim checkout used by this workbench reads a [layout] section
  // unconditionally, even when -l layout.csv is provided. Therefore the cfg
  // must always include the required layout/banking keys. The UI option
  // `emitLayoutSection` is kept for compatibility with older project files, but
  // it no longer removes this section; it only controls whether the user should
  // think of these values as advanced/customized. Defaults are conservative and
  // match the SCALE-Sim parser's expected keys.
  lines.push(
    "[layout]",
    `IfmapCustomLayout = ${bool(sc.ifmapCustomLayout)}`,
    `FilterCustomLayout = ${bool(sc.filterCustomLayout)}`,
    `IfmapSRAMBankBandwidth = ${positiveInt(sc.ifmapSRAMBankBandwidth, 10)}`,
    `IfmapSRAMBankNum = ${positiveInt(sc.ifmapSRAMBankNum, 10)}`,
    `IfmapSRAMBankPort = ${positiveInt(sc.ifmapSRAMBankPort, 2)}`,
    `FilterSRAMBankBandwidth = ${positiveInt(sc.filterSRAMBankBandwidth, 10)}`,
    `FilterSRAMBankNum = ${positiveInt(sc.filterSRAMBankNum, 10)}`,
    `FilterSRAMBankPort = ${positiveInt(sc.filterSRAMBankPort, 2)}`,
  );
  return lines.join("\n") + "\n";
}
export function generateScaleSimTopology(res: SearchResponse): string {
  const rows = ["Layer name,IFMAP Height,IFMAP Width,Filter Height,Filter Width,Channels,Num Filter,Strides,Batch Size,Sparsity Ratio,"];
  for (const r of res.results) {
    const s = r.shape;
    // GEMM approximation encoded as a 1D conv row for SCALE-Sim compatibility.
    // The explicit Sparsity Ratio and trailing comma are required by recent SCALE-Sim parsers.
    rows.push(`${sanitize(s.opName)},${s.m},1,1,1,${s.k},${s.n},1,1,1:1,`);
  }
  return rows.join("\n") + "\n";
}
export function generateScaleSimLayout(res: SearchResponse): string {
  const header = "Layer name,IFMAP Height Intraline Factor,IFMAP Width Intraline Factor,Filter Height Intraline Factor,Filter Width Intraline Factor,Channel Intraline Factor,Num Filter Intraline Factor,IFMAP Height Intraline Order,IFMAP Width Intraline Order,Channel Intraline Order,IFMAP Height Interline Order,IFMAP Width Interline Order,Channel Interline Order,Num Filter Intraline Order,Channel Intraline Order,Filter Height Intraline Order,Filter Width Intraline Order,Num Filter Interline Order,Channel Interline Order,Filter Height Interline Order,Filter Width Interline Order,";
  // SCALE-Sim custom-layout code transposes a 6D IFMAP tensor using
  // (interline[0..2], intraline[0..2]). Therefore the two order groups
  // must be disjoint axes. Use 1-based axes here because SCALE-Sim converts
  // them to zero-based internally. The old 1,2,3 + 1,2,3 pattern caused
  // "ValueError: repeated axis in transpose" when custom layout was enabled.
  const defaultRow = "1,1,1,1,1,1,4,5,6,1,2,3,5,6,7,8,1,2,3,4,";
  const rows = [header];
  for (const r of res.results) rows.push(`${sanitize(r.shape.opName)},${defaultRow}`);
  return rows.join("\n") + "\n";
}
export interface ScaleSimTopkCandidate {
  layerName: string;
  shapeId: string;
  model: string;
  opName: string;
  rank: number;
  tileM: number;
  tileN: number;
  tileK: number;
  tileCount: number;
  predictedCycles: number;
  predictedTimeUs: number;
  predictedUtilization: number;
  predictedPaddingRatio: number;
  predictedSramBytes: number;
}
export function scaleSimTopkCandidates(res: SearchResponse, topK = 3): ScaleSimTopkCandidate[] {
  const out: ScaleSimTopkCandidate[] = [];
  for (const r of res.results) {
    const s = r.shape;
    r.candidates.slice(0, topK).forEach((c, index) => {
      out.push({
        layerName: scaleSimTopkLayerName(s.opName, index + 1, c.tileM, c.tileN, c.tileK),
        shapeId: s.id,
        model: s.model,
        opName: s.opName,
        rank: index + 1,
        tileM: c.tileM,
        tileN: c.tileN,
        tileK: c.tileK,
        tileCount: Math.ceil(s.m / c.tileM) * Math.ceil(s.n / c.tileN) * Math.ceil(s.k / c.tileK),
        predictedCycles: c.cycles,
        predictedTimeUs: c.timeUs,
        predictedUtilization: c.utilization,
        predictedPaddingRatio: c.paddingRatio,
        predictedSramBytes: c.sramBytes,
      });
    });
  }
  return out;
}
export function generateScaleSimTopkTopology(res: SearchResponse): string {
  const rows = ["Layer name,IFMAP Height,IFMAP Width,Filter Height,Filter Width,Channels,Num Filter,Strides,Batch Size,Sparsity Ratio,"];
  for (const c of scaleSimTopkCandidates(res)) {
    rows.push(`${c.layerName},${c.tileM},1,1,1,${c.tileK},${c.tileN},1,1,1:1,`);
  }
  return rows.join("\n") + "\n";
}
export function generateScaleSimTopkLayout(res: SearchResponse): string {
  const header = "Layer name,IFMAP Height Intraline Factor,IFMAP Width Intraline Factor,Filter Height Intraline Factor,Filter Width Intraline Factor,Channel Intraline Factor,Num Filter Intraline Factor,IFMAP Height Intraline Order,IFMAP Width Intraline Order,Channel Intraline Order,IFMAP Height Interline Order,IFMAP Width Interline Order,Channel Interline Order,Num Filter Intraline Order,Channel Intraline Order,Filter Height Intraline Order,Filter Width Intraline Order,Num Filter Interline Order,Channel Interline Order,Filter Height Interline Order,Filter Width Interline Order,";
  const defaultRow = "1,1,1,1,1,1,4,5,6,1,2,3,5,6,7,8,1,2,3,4,";
  const rows = [header];
  for (const c of scaleSimTopkCandidates(res)) rows.push(`${c.layerName},${defaultRow}`);
  return rows.join("\n") + "\n";
}
export function generatedShapesCsv(res: SearchResponse): string { return shapesToCsv(res.request.shapes); }
function sanitize(s: string): string { return s.replace(/[^A-Za-z0-9_]/g, "_"); }
function scaleSimTopkLayerName(opName: string, rank: number, tileM: number, tileN: number, tileK: number): string {
  return sanitize(`${opName}_rank${rank}_tm${tileM}_tn${tileN}_tk${tileK}`);
}
