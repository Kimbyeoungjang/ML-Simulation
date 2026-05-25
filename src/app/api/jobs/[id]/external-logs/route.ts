import { NextResponse } from "next/server";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { assertSafeJobId, jobDir, resolveInside } from "@/server/workspace";

export const dynamic = "force-dynamic";

type LogFile = { path: string; bytes: number; text: string; updatedAt?: string };

async function listLogFiles(root: string, maxDepth = 6): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    let entries: import("node:fs").Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = resolveInside(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isFile() && /(?:^|[\\/])(?:scalesim|iree).*\.log$/i.test(rel)) out.push(rel);
      if (entry.isDirectory() && depth > 0) await walk(full, depth - 1);
    }
  }
  await walk(root, maxDepth);
  return out.sort();
}

function sanitizeExternalToolLogForDisplay(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let hidden = 0;
  for (const line of lines) {
    // tqdm/terminal helpers in SCALE-Sim sometimes emit this Windows shell message even when exitCode=0.
    // It is not a SCALE-Sim failure and only makes the live log look scary.
    if (/^\s*명령 구문이 올바르지 않습니다[.]?\s*$/.test(line)) { hidden += 1; continue; }
    kept.push(line);
  }
  if (hidden > 0) kept.push(`(${hidden}개 Windows 콘솔 보조 명령 메시지를 숨겼습니다.)`);
  return kept.join("\n");
}

async function readTail(file: string, maxChars: number): Promise<{ text: string; bytes: number; updatedAt?: string }> {
  const s = await stat(file);
  const maxBytes = Math.min(s.size, Math.max(8192, maxChars * 4));
  let raw = "";
  const handle = await open(file, "r").catch(() => null);
  if (handle) {
    try {
      const buffer = Buffer.alloc(maxBytes);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, Math.max(0, s.size - maxBytes));
      raw = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close().catch(() => undefined);
    }
  }
  const text = sanitizeExternalToolLogForDisplay(raw);
  return {
    text: text.length > maxChars ? text.slice(-maxChars) : text,
    bytes: s.size,
    updatedAt: s.mtime.toISOString(),
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  try { assertSafeJobId(id); } catch { return NextResponse.json({ error: "invalid job id" }, { status: 400 }); }
  const rawMaxChars = Number(url.searchParams.get("maxChars") ?? 16000);
  const maxChars = Number.isFinite(rawMaxChars) ? Math.min(Math.max(Math.floor(rawMaxChars), 1000), 200000) : 16000;
  const root = path.resolve(jobDir(id));
  const names = await listLogFiles(root);
  const logs: LogFile[] = [];
  for (const rel of names.slice(-12)) {
    try {
      const data = await readTail(resolveInside(root, rel), maxChars);
      logs.push({ path: rel, ...data });
    } catch {}
  }
  return NextResponse.json({ id, logs, generatedAt: new Date().toISOString() });
}
