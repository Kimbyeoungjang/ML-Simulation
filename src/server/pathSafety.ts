import path from "node:path";

/**
 * Resolve a user-provided relative path under an allowed root.
 *
 * `startsWith(root)` is not safe because `/tmp/job` also prefixes
 * `/tmp/job-evil`.  This helper uses `path.relative` so artifact uploads and
 * estimator-suite dataset references cannot escape the job directory.
 */
export function resolveInsideRoot(root: string, candidate: string) {
  const abs = path.resolve(root, candidate);
  const rel = path.relative(root, abs);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    return abs;
  }
  return undefined;
}
