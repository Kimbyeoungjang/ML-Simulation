import { z } from "zod";
import type { JobKind } from "@/types/job";

const positiveInt = z.number().int().positive();
const positiveNum = z.number().positive();
const boundedCandidateList = z.array(positiveInt).min(1).max(64).transform(values => [...new Set(values)].sort((a, b) => a - b));

export const DataflowSchema = z.enum(["WS", "OS", "IS"]);
export const ObjectiveSchema = z.enum(["balanced", "cycles", "utilization", "hardware-design", "pareto"]);
export const JobKindSchema = z.enum(["estimate", "scalesim", "iree-compile", "full-pipeline"]);

export const HardwareSchema = z.object({
  name: z.string().min(1).default("custom"),
  arrayRows: positiveInt,
  arrayCols: positiveInt,
  frequencyMHz: positiveNum,
  sramKB: positiveNum,
  dataflow: DataflowSchema,
  bytesPerElement: positiveInt.default(2),
  memoryBandwidthGBs: positiveNum.optional(),
  energyPerMacPJ: positiveNum.optional(),
  energyPerSramAccessPJ: positiveNum.optional(),
  energyPerDramBytePJ: positiveNum.optional(),
  staticPowerW: positiveNum.optional(),
  dispatchOverheadUs: z.number().nonnegative().optional(),
  doubleBuffering: z.boolean().optional()
});

export const MatmulShapeSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  opName: z.string().min(1),
  m: positiveInt,
  n: positiveInt,
  k: positiveInt,
  dtypeBytes: positiveInt.default(2),
  source: z.enum(["manual", "csv", "conv", "onnx", "mlir", "import"]).optional()
});

export const TileCandidatesSchema = z.object({
  tileM: boundedCandidateList,
  tileN: boundedCandidateList,
  tileK: boundedCandidateList
}).superRefine((value, ctx) => {
  const total = value.tileM.length * value.tileN.length * value.tileK.length;
  if (total > 250_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Too many tile combinations (${total}). Enable pruning or reduce candidate lists.` });
  }
});

export const CalibrationSampleSchema = z.object({
  model: z.string().optional(),
  opName: z.string().optional(),
  arrayRows: positiveInt.optional(),
  arrayCols: positiveInt.optional(),
  dataflow: DataflowSchema.optional(),
  tileM: positiveInt.optional(),
  tileN: positiveInt.optional(),
  tileK: positiveInt.optional(),
  predictedCycles: positiveNum,
  measuredCycles: positiveNum.optional(),
  measuredRuntimeUs: positiveNum.optional(),
  factor: positiveNum
});


export const ScaleSimOverridesSchema = z.object({
  runName: z.string().min(1).optional(),
  bandwidth: positiveNum.optional(),
  interfaceBandwidth: z.string().min(1).optional(),
  ifmapSramKB: positiveNum.optional(),
  filterSramKB: positiveNum.optional(),
  ofmapSramKB: positiveNum.optional(),
  ifmapOffset: z.number().nonnegative().optional(),
  filterOffset: z.number().nonnegative().optional(),
  ofmapOffset: z.number().nonnegative().optional(),
  dataflow: z.string().min(1).optional(),
  useLayout: z.boolean().optional(),
  ifmapCustomLayout: z.boolean().optional(),
  filterCustomLayout: z.boolean().optional(),
  ifmapSRAMBankBandwidth: positiveNum.optional(),
  ifmapSRAMBankNum: positiveInt.optional(),
  ifmapSRAMBankPort: positiveInt.optional(),
  filterSRAMBankBandwidth: positiveNum.optional(),
  filterSRAMBankNum: positiveInt.optional(),
  filterSRAMBankPort: positiveInt.optional(),
  emitLayoutSection: z.boolean().optional()
}).optional();

export const CalibrationProfileSchema = z.object({
  name: z.string().min(1),
  createdAt: z.string().min(1),
  globalCycleFactor: positiveNum,
  byArray: z.record(z.string(), positiveNum).optional(),
  byDataflow: z.record(DataflowSchema, positiveNum).optional(),
  byOp: z.record(z.string(), positiveNum).optional(),
  samples: z.array(CalibrationSampleSchema).default([])
}).optional();

export const SearchRequestSchema = z.object({
  hardware: HardwareSchema,
  shapes: z.array(MatmulShapeSchema).min(1).max(4096),
  candidates: TileCandidatesSchema,
  objective: ObjectiveSchema.default("balanced"),
  maxResultsPerOp: positiveInt.max(4096).optional(),
  calibration: CalibrationProfileSchema,
  scaleSim: ScaleSimOverridesSchema
}).superRefine((req, ctx) => {
  const combos = req.candidates.tileM.length * req.candidates.tileN.length * req.candidates.tileK.length * req.shapes.length;
  if (combos > 1_000_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Search would evaluate ${combos.toLocaleString()} candidates. Use background jobs, pruning, or fewer candidates.` });
  }
  const smallestTileBytes = (Math.min(...req.candidates.tileM) * Math.min(...req.candidates.tileK) + Math.min(...req.candidates.tileK) * Math.min(...req.candidates.tileN) + Math.min(...req.candidates.tileM) * Math.min(...req.candidates.tileN)) * req.hardware.bytesPerElement;
  if (smallestTileBytes > req.hardware.sramKB * 1024 * 4) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Even the smallest tile is far larger than configured SRAM. Check SRAM KB or tile candidates." });
  }
});

export const ProjectFileSchema = z.object({
  version: z.string().min(1).default("tileforge.project.v1"),
  name: z.string().min(1).default("TileForge project"),
  createdAt: z.string().min(1).default(() => new Date().toISOString()),
  hardware: HardwareSchema,
  shapes: z.array(MatmulShapeSchema).min(1),
  candidates: TileCandidatesSchema,
  objective: ObjectiveSchema.default("balanced"),
  scaleSim: ScaleSimOverridesSchema,
  notes: z.string().optional()
});

export function parseSearchRequest(input: unknown) {
  return SearchRequestSchema.parse(input);
}

export function parseJobKind(input: unknown): JobKind {
  const parsed = JobKindSchema.safeParse(input);
  return parsed.success ? parsed.data : "full-pipeline";
}

export function formatZodError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues.map(i => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

export function validateExternalToolEnv() {
  return {
    scalesim: Boolean(process.env.TILEFORGE_SCALE_SIM_CMD),
    iree: Boolean(process.env.TILEFORGE_IREE_COMPILE_CMD),
    mlirOpt: Boolean(process.env.TILEFORGE_MLIR_OPT_CMD),
    nodeEnv: process.env.NODE_ENV ?? "development"
  };
}

export function estimateCandidateCount(shapes: readonly unknown[], candidates: { tileM: readonly unknown[]; tileN: readonly unknown[]; tileK: readonly unknown[] }) {
  return shapes.length * candidates.tileM.length * candidates.tileN.length * candidates.tileK.length;
}
