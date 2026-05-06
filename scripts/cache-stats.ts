import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { getWorkspaceRoot } from "../src/server/workspace";

async function walk(dir: string): Promise<{ files: number; bytes: number }> {
  try {
    let files = 0, bytes = 0;
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { const r = await walk(p); files += r.files; bytes += r.bytes; }
      else { files++; bytes += (await stat(p)).size; }
    }
    return { files, bytes };
  } catch { return { files: 0, bytes: 0 }; }
}

async function main(): Promise<void> {
  const cacheRoot = path.join(getWorkspaceRoot(), "cache");
  const r = await walk(cacheRoot);
  console.log(JSON.stringify({ cacheRoot, files: r.files, bytes: r.bytes, mb: +(r.bytes / 1024 / 1024).toFixed(2) }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
