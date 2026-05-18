export type Dataflow = "WS" | "OS" | "IS";
export type Objective = "balanced" | "cycles" | "utilization" | "hardware-design" | "pareto";

export interface ScaleSimOverrides {
  runName?: string;
  bandwidth?: number;
  /** Alias/preferred UI name for SCALE-Sim Bandwidth: DRAM/global memory interface bandwidth. */
  dramBandwidth?: number;
  interfaceBandwidth?: "USER" | "CALC" | string;
  ifmapSramKB?: number;
  filterSramKB?: number;
  ofmapSramKB?: number;
  ifmapOffset?: number;
  filterOffset?: number;
  ofmapOffset?: number;
  dataflow?: Dataflow | string;
  useLayout?: boolean;
  ifmapCustomLayout?: boolean;
  filterCustomLayout?: boolean;
  ifmapSRAMBankBandwidth?: number;
  ifmapSRAMBankNum?: number;
  ifmapSRAMBankPort?: number;
  filterSRAMBankBandwidth?: number;
  filterSRAMBankNum?: number;
  filterSRAMBankPort?: number;
  emitLayoutSection?: boolean;
}

export interface HardwareConfig {
  name: string;
  arrayRows: number;
  arrayCols: number;
  frequencyMHz: number;
  sramKB: number;
  dataflow: Dataflow;
  bytesPerElement: number;
  memoryBandwidthGBs?: number;
  energyPerMacPJ?: number;
  energyPerSramAccessPJ?: number;
  energyPerDramBytePJ?: number;
  staticPowerW?: number;
  dispatchOverheadUs?: number;
  doubleBuffering?: boolean;
}

export interface MatmulShape {
  id: string;
  model: string;
  opName: string;
  m: number;
  n: number;
  k: number;
  dtypeBytes: number;
  source?: "manual" | "csv" | "conv" | "onnx" | "mlir" | "import";
}

export interface Conv2DShape {
  id: string;
  model: string;
  opName: string;
  batch: number;
  inputH: number;
  inputW: number;
  inputC: number;
  outputC: number;
  kernelH: number;
  kernelW: number;
  strideH: number;
  strideW: number;
  padH: number;
  padW: number;
  dilationH: number;
  dilationW: number;
  dtypeBytes: number;
}

export interface TileCandidates { tileM: number[]; tileN: number[]; tileK: number[]; }
export interface SearchRequest { hardware: HardwareConfig; shapes: MatmulShape[]; candidates: TileCandidates; objective: Objective; maxResultsPerOp?: number; scaleSim?: ScaleSimOverrides; }
export interface TileCandidateResult {
  shapeId: string; model: string; opName: string;
  tileM: number; tileN: number; tileK: number;
  cycles: number; rawCycles?: number; calibrationFactor?: number; timeUs: number; utilization: number; paddingRatio: number; sramBytes: number;
  learnedMetrics?: { sramBytes?: number; dramBytes?: number; utilization?: number; availableTargets?: string[] };
  boundaryPenalty: number; score: number; isPareto: boolean; warnings: string[]; explanation: string;
}
export interface OpSearchResult { shape: MatmulShape; best: TileCandidateResult; candidates: TileCandidateResult[]; pareto: TileCandidateResult[]; heatmap: HeatmapPoint[]; }
export interface HeatmapPoint { tileM: number; tileN: number; tileK: number; cycles: number; utilization: number; sramBytes: number; paddingRatio: number; score: number; }
export interface SearchResponse { request: SearchRequest; results: OpSearchResult[]; summary: SummaryMetrics; artifacts: GeneratedArtifacts; designAdvice: string[]; bottlenecks?: BottleneckAnalysis; roofline?: RooflinePoint[]; energy?: EnergySummary; }
export interface SummaryMetrics { totalCycles: number; totalTimeUs: number; meanUtilization: number; meanPaddingRatio: number; maxSramBytes: number; bottleneckOp: string; }
export interface BottleneckAnalysis { totalCycles: number; topOps: Array<{ opName: string; model: string; cycles: number; percent: number; issue: string; }>; lowUtilizationOps: string[]; highPaddingOps: string[]; sramRiskOps: string[]; }
export interface RooflinePoint { opName: string; model: string; arithmeticIntensity: number; achievedGops: number; computeRoofGops: number; memoryRoofGops: number; bound: "compute" | "memory"; }
export interface EnergySummary { totalEnergyUJ: number; totalMacEnergyUJ: number; totalSramEnergyUJ: number; totalDramEnergyUJ: number; totalStaticEnergyUJ: number; edp: number; byOp: Array<{ opName: string; model: string; energyUJ: number; energyPercent: number; }>; }
export interface GeneratedArtifacts { policyCsv: string; mlir: string; transformDialect: string; reportMarkdown: string; scaleSimConfig: string; scaleSimTopology: string; scaleSimLayout?: string; scaleSimTopkTopology?: string; scaleSimTopkLayout?: string; projectJson: string; manifestJson?: string; ireeCommand?: string; latexTable?: string; svgSummary?: string; experimentComparisonCsv?: string; validationMarkdown?: string; validationCsv?: string; robustPolicyMarkdown?: string; robustPolicyCsv?: string; dataflowComparisonCsv?: string; memoryTrafficCsv?: string; pruneReportMarkdown?: string; tileScheduleSvg?: string; }
export interface ArraySweepRequest { baseHardware: HardwareConfig; shapes: MatmulShape[]; candidates: TileCandidates; arrays: Array<{ rows: number; cols: number }>; objective: Objective; }
export interface ArraySweepResult { arrayRows: number; arrayCols: number; totalCycles: number; meanUtilization: number; maxSramBytes: number; score: number; advice: string[]; }
export interface ProjectFile { version: string; name: string; createdAt: string; hardware: HardwareConfig; shapes: MatmulShape[]; candidates: TileCandidates; objective: Objective; scaleSim?: ScaleSimOverrides; notes?: string; }

export interface ExperimentComparison { name: string; hardware: HardwareConfig; totalCycles: number; meanUtilization: number; maxSramBytes: number; totalEnergyUJ?: number; bottleneckOp: string; }
