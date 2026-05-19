import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { isGeneratedPath, toPosixPath } from "./generated-paths";

const allowed = new Set(["node_modules", ".git"]);
const found: string[] = [];

function walk(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const rel = toPosixPath(path.relative(process.cwd(), p));
    if (allowed.has(rel)) continue;
    if (isGeneratedPath(rel)) {
      found.push(rel);
      continue;
    }
    if (entry.isDirectory()) walk(p);
  }
}

if (existsSync(process.cwd())) walk(process.cwd());

if (found.length > 0) {
  console.error("Generated/local artifacts found in the source tree:");
  for (const rel of found.slice(0, 50)) console.error(`- ${rel}`);
  if (found.length > 50) console.error(`...and ${found.length - 50} more`);
  console.error("Run npm run clean:generated before packaging or committing.");
  process.exit(1);
}

console.log("source tree is clean");
