import { mkdir, rename, rm, writeFile, readFile, access, open } from "node:fs/promises";
import path from "node:path";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableFsError(error: unknown): boolean {
  const code = String((error as NodeJS.ErrnoException)?.code ?? "");
  return ["EPERM", "EACCES", "EBUSY", "ENOTEMPTY", "EMFILE", "ENFILE"].includes(code);
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(1000, Math.round(20 * Math.pow(attempt + 1, 1.35)));
  const jitter = Math.floor(Math.random() * 25);
  return base + jitter;
}

export interface AtomicWriteOptions {
  retries?: number;
  directFallback?: boolean;
}

async function retryFs<T>(label: string, fn: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetriableFsError(error) || attempt === retries) break;
      await sleep(retryDelayMs(attempt));
    }
  }
  const err = lastError as NodeJS.ErrnoException;
  const detail = err?.code ? `${err.code}: ${err.message}` : String(lastError);
  throw new Error(`${label} failed after ${retries + 1} attempt(s): ${detail}`);
}

/**
 * Windows-friendly atomic write.
 *
 * Windows can transiently reject rename(tmp -> job.json) with EPERM/EACCES/EBUSY
 * when another process, editor, antivirus, or the dev server reads the destination
 * file at exactly the same time. Job state writes are frequent, so a single rename
 * failure must not kill the worker queue. We therefore retry the atomic rename for
 * a few seconds and, as a last resort, fall back to a direct overwrite. The direct
 * fallback is less atomic, but it is preferable to leaving a job stuck in running
 * state and blocking the queue. Set TILEFORGE_DISABLE_ATOMIC_DIRECT_FALLBACK=1 to
 * disable that last-resort behavior.
 */
export async function atomicWriteFile(filePath: string, data: string | Buffer, options: AtomicWriteOptions = {}) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const retries = options.retries ?? Number(process.env.TILEFORGE_ATOMIC_WRITE_RETRIES ?? 80);
  const directFallback = options.directFallback ?? process.env.TILEFORGE_DISABLE_ATOMIC_DIRECT_FALLBACK !== "1";
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const handle = await open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await retryFs(`rename ${tmp} -> ${filePath}`, () => rename(tmp, filePath), retries);
  } catch (renameError) {
    if (!directFallback) {
      await rm(tmp, { force: true }).catch(() => undefined);
      throw renameError;
    }
    try {
      await retryFs(`direct write ${filePath}`, () => writeFile(filePath, data), Math.max(10, Math.floor(retries / 4)));
      await rm(tmp, { force: true }).catch(() => undefined);
    } catch (directError) {
      await rm(tmp, { force: true }).catch(() => undefined);
      const first = renameError instanceof Error ? renameError.message : String(renameError);
      const second = directError instanceof Error ? directError.message : String(directError);
      throw new Error(`atomic write failed and direct fallback also failed. rename=${first}; direct=${second}`);
    }
  }
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
