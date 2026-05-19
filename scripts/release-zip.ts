import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createZip } from "../src/lib/zip";
import { isGeneratedPath, toPosixPath } from "./generated-paths";

const MAX_RELEASE_FILE_BYTES = 10 * 1024 * 1024;
const files: Record<string, Buffer> = {};

function walk(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const rel = toPosixPath(path.relative(process.cwd(), p));
    if (isGeneratedPath(rel)) continue;
    if (entry.isDirectory()) {
      walk(p);
      continue;
    }
    if (statSync(p).size <= MAX_RELEASE_FILE_BYTES) files[rel] = readFileSync(p);
  }
}

walk(process.cwd());
mkdirSync("release", { recursive: true });
writeFileSync("release/tileforge-workbench-v13.zip", createZip(files));
console.log(`release/tileforge-workbench-v13.zip (${Object.keys(files).length} files)`);
