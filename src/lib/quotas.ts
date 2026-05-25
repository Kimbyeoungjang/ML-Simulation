export interface QuotaConfig { maxQueuedJobs: number; maxRunningJobs: number; maxArtifactsMB: number; maxBundleMB: number; maxCandidates: number; }
export function quotaConfig(): QuotaConfig {
  return {
    maxQueuedJobs: Number(process.env.TILEFORGE_MAX_QUEUED_JOBS ?? 10000),
    maxRunningJobs: Number(process.env.TILEFORGE_MAX_RUNNING_JOBS ?? 2),
    maxArtifactsMB: Number(process.env.TILEFORGE_MAX_ARTIFACTS_MB ?? 2048),
    maxBundleMB: Number(process.env.TILEFORGE_MAX_BUNDLE_MB ?? 500),
    maxCandidates: Number(process.env.TILEFORGE_MAX_CANDIDATES ?? 500000)
  };
}
