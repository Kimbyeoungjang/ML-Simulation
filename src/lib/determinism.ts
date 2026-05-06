export function deterministicMode(): boolean { return process.env.TILEFORGE_DETERMINISTIC === "1" || process.env.TILEFORGE_DETERMINISTIC === "true"; }
export function nowIso(): string { return deterministicMode() ? "2000-01-01T00:00:00.000Z" : new Date().toISOString(); }
export function stableId(prefix = "job"): string { return deterministicMode() ? `${prefix}_deterministic` : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`; }
export function roundStable(value: number, digits = 6): number { return Number(value.toFixed(digits)); }
