import { mkdir, rename, rm, writeFile, readFile, access, open } from "node:fs/promises";
import path from "node:path";

export async function atomicWriteFile(filePath: string, data: string | Buffer) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, filePath);
}

export async function writeStageMarker(dir: string, stage: string, payload: object = {}) {
  await atomicWriteFile(path.join(dir, `${stage}.done.json`), JSON.stringify({ stage, doneAt: new Date().toISOString(), ...payload }, null, 2));
}

export async function hasStageMarker(dir: string, stage: string) {
  try { await access(path.join(dir, `${stage}.done.json`)); return true; } catch { return false; }
}

export async function readStageMarker<T = any>(dir: string, stage: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path.join(dir, `${stage}.done.json`), "utf8")); } catch { return undefined; }
}

export async function clearIncompleteStage(dir: string, stage: string, artifacts: string[] = []) {
  if (await hasStageMarker(dir, stage)) return;
  await Promise.all(artifacts.map(a => rm(path.join(dir, a), { force: true })));
}
