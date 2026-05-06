import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

async function main(): Promise<void> {
  const root = process.env.TILEFORGE_JOB_ROOT ? path.resolve(process.env.TILEFORGE_JOB_ROOT) : path.join(process.cwd(), ".tileforge_jobs");
  const daysArg = process.argv.find(a => a.startsWith("--older-than-days="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : undefined;

  if (!days) {
    await rm(root, { recursive: true, force: true });
    console.log(`Removed ${root}`);
    return;
  }

  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  let removed = 0;
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const s = await stat(dir).catch(() => undefined);
    if (s && s.mtimeMs < cutoff) {
      await rm(dir, { recursive: true, force: true });
      removed++;
    }
  }
  console.log(`Removed ${removed} job directories older than ${days} day(s)`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
