import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { getWorkspaceRoot } from "../src/server/workspace";

async function main(): Promise<void> {
  const maxAgeDays = Number(process.argv.find(a => a.startsWith("--max-age-days="))?.split("=")[1] ?? process.env.TILEFORGE_CACHE_MAX_AGE_DAYS ?? 30);
  const cacheRoot = path.join(getWorkspaceRoot(), "cache");
  let removed = 0;
  try {
    const now = Date.now();
    for (const e of await readdir(cacheRoot, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(cacheRoot, e.name);
      const s = await stat(p);
      if ((now - s.mtimeMs) / 86400000 > maxAgeDays) {
        await rm(p, { recursive: true, force: true });
        removed++;
      }
    }
  } catch {}
  console.log(`Removed ${removed} cache entr${removed === 1 ? "y" : "ies"} older than ${maxAgeDays} day(s).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
