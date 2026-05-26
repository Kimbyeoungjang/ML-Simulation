import { rm } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { cleanGeneratedTargets, generatedSuffixes, isGeneratedPath, toPosixPath } from "./generated-paths";

async function removePath(p: string): Promise<void> {
  try {
    await rm(p, { recursive: true, force: true });
    console.log(`removed ${p}`);
  } catch (error) {
    console.warn(`could not remove ${p}:`, error instanceof Error ? error.message : error);
  }
}

function generatedSuffixFiles(root = process.cwd()): string[] {
  const out: string[] = [];
  const ignored = new Set([".git", "node_modules"]);
  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = toPosixPath(path.relative(root, full));
      if (ignored.has(rel)) continue;
      if (entry.isDirectory()) {
        if (isGeneratedPath(rel)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (generatedSuffixes.some(suffix => rel.endsWith(suffix))) out.push(rel);
    }
  }
  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {
    return out;
  }
  return out.sort();
}

async function main(): Promise<void> {
  const suffixTargets = generatedSuffixFiles();
  await Promise.all([...cleanGeneratedTargets, ...suffixTargets].map(removePath));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
