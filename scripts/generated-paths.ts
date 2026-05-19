export const generatedPathPrefixes = [
  ".git/",
  ".next/",
  ".tileforge/",
  ".tileforge_jobs/",
  "coverage/",
  "benchmarks/results/",
  "dist/",
  "external/",
  "node_modules/",
  "out/",
  "release/",
] as const;

export const generatedExactPaths = [
  ".DS_Store",
  ".env",
  ".env.local",
  ".env.development.local",
  ".env.test.local",
  ".env.production.local",
  "COMPUTE_REPORT.csv",
  "model.vmfb",
  "reports/soak-worker.json",
  "tsconfig.tsbuildinfo",
] as const;

export const generatedSuffixes = [".log", ".tsbuildinfo", ".vmfb"] as const;

export function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isGeneratedPath(path: string): boolean {
  const rel = toPosixPath(path);
  return (
    generatedExactPaths.includes(rel as (typeof generatedExactPaths)[number]) ||
    generatedPathPrefixes.some(prefix => rel === prefix.slice(0, -1) || rel.startsWith(prefix)) ||
    generatedSuffixes.some(suffix => rel.endsWith(suffix))
  );
}

export const cleanGeneratedTargets = [
  ...generatedPathPrefixes.map(path => path.slice(0, -1)).filter(path => path !== ".git" && path !== "node_modules"),
  ...generatedExactPaths.filter(path => path !== ".DS_Store"),
] as const;
