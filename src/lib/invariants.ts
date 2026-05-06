import type { SearchResponse, TileCandidateResult } from "@/types/domain";

export class NumericalInvariantError extends Error {
  constructor(message: string, public readonly context?: Record<string, unknown>) {
    super(message);
    this.name = "NumericalInvariantError";
  }
}

export function assertFiniteNumber(name: string, value: number, context?: Record<string, unknown>) {
  if (!Number.isFinite(value)) throw new NumericalInvariantError(`${name} must be finite`, { value, ...context });
}

export function assertTileCandidateInvariant(c: TileCandidateResult) {
  const ctx = { opName: c.opName, tileM: c.tileM, tileN: c.tileN, tileK: c.tileK };
  for (const [name, value] of Object.entries({ cycles: c.cycles, timeUs: c.timeUs, utilization: c.utilization, paddingRatio: c.paddingRatio, sramBytes: c.sramBytes, score: c.score })) {
    assertFiniteNumber(name, value as number, ctx);
  }
  if (c.cycles <= 0) throw new NumericalInvariantError("cycles must be positive", ctx);
  if (c.tileM <= 0 || c.tileN <= 0 || c.tileK <= 0) throw new NumericalInvariantError("tile dimensions must be positive", ctx);
  if (c.utilization < 0 || c.utilization > 1) throw new NumericalInvariantError("utilization must be in [0, 1]", { utilization: c.utilization, ...ctx });
  if (c.paddingRatio < 0) throw new NumericalInvariantError("paddingRatio must be non-negative", { paddingRatio: c.paddingRatio, ...ctx });
  if (c.sramBytes < 0) throw new NumericalInvariantError("sramBytes must be non-negative", { sramBytes: c.sramBytes, ...ctx });
}

export function assertSearchResponseInvariant(res: SearchResponse) {
  assertFiniteNumber("totalCycles", res.summary.totalCycles);
  assertFiniteNumber("meanUtilization", res.summary.meanUtilization);
  if (res.summary.meanUtilization < 0 || res.summary.meanUtilization > 1) throw new NumericalInvariantError("summary.meanUtilization must be in [0, 1]");
  for (const op of res.results) {
    if (!op.best) throw new NumericalInvariantError("each op must have a best tile", { opName: op.shape.opName });
    assertTileCandidateInvariant(op.best);
    for (const c of op.candidates) assertTileCandidateInvariant(c);
  }
}

export function invariantMode(): "off" | "warn" | "throw" {
  const mode = process.env.TILEFORGE_INVARIANTS ?? (process.env.NODE_ENV === "production" ? "warn" : "throw");
  return mode === "off" || mode === "warn" || mode === "throw" ? mode : "throw";
}

export function runInvariant(label: string, fn: () => void, warnings?: string[]) {
  const mode = invariantMode();
  if (mode === "off") return;
  try { fn(); }
  catch (e: any) {
    const msg = `${label}: ${e?.message ?? e}`;
    if (mode === "warn") warnings?.push(msg);
    else throw e;
  }
}
