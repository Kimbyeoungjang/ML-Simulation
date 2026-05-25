import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createZip } from "../src/lib/zip";

const ignore = new Set(["node_modules", ".next", ".tileforge", "dist", "coverage", "release"]);
const files: Record<string, Buffer> = {};
function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    const rel = path.relative(process.cwd(), p).replace(/\\/g, "/");
    if (entry.isDirectory()) walk(p);
    else if (statSync(p).size < 10 * 1024 * 1024) files[rel] = readFileSync(p);
  }
}
walk(process.cwd());
mkdirSync("release", { recursive: true });
writeFileSync("release/tileforge-workbench-v13.zip", createZip(files));
console.log(`release/tileforge-workbench-v13.zip (${Object.keys(files).length} files)`);
