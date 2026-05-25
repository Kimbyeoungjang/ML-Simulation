export interface QuotaConfig { maxQueuedJobs: number; maxRunningJobs: number; maxArtifactsMB: number; maxBundleMB: number; maxCandidates: number; }

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

export function quotaConfig(): QuotaConfig {
  return {
    maxQueuedJobs: intEnv("TILEFORGE_MAX_QUEUED_JOBS", 100, 1, 10_000),
    maxRunningJobs: intEnv("TILEFORGE_MAX_RUNNING_JOBS", 2, 1, 64),
    maxArtifactsMB: intEnv("TILEFORGE_MAX_ARTIFACTS_MB", 2048, 1, 1_048_576),
    maxBundleMB: intEnv("TILEFORGE_MAX_BUNDLE_MB", 500, 1, 100_000),
    maxCandidates: intEnv("TILEFORGE_MAX_CANDIDATES", 500_000, 1, 50_000_000)
  };
}

export const __quotaInternalsForTests = { intEnv };
