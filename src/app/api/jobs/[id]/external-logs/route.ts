import { NextResponse } from "next/server";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";

export const dynamic = "force-dynamic";

type LogFile = { path: string; bytes: number; text: string; updatedAt?: string };

async function listLogFiles(root: string, maxDepth = 6): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    let entries: import("node:fs").Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full);
      if (entry.isFile() && /(?:^|[\\/])(?:scalesim|iree).*\.log$/i.test(rel)) out.push(rel);
      if (entry.isDirectory() && depth > 0) await walk(full, depth - 1);
    }
  }
  await walk(root, maxDepth);
  return out.sort();
}

async function readTail(file: string, maxChars: number): Promise<{ text: string; bytes: number; updatedAt?: string }> {
  const s = await stat(file);
  const text = await readFile(file, "utf8").catch(() => "");
  return {
    text: text.length > maxChars ? text.slice(-maxChars) : text,
    bytes: s.size,
    updatedAt: s.mtime.toISOString(),
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const maxChars = Math.min(Math.max(Number(url.searchParams.get("maxChars") ?? 16000), 1000), 200000);
  const root = path.resolve(jobDir(id));
  const names = await listLogFiles(root);
  const logs: LogFile[] = [];
  for (const rel of names.slice(-12)) {
    try {
      const data = await readTail(path.join(root, rel), maxChars);
      logs.push({ path: rel, ...data });
    } catch {}
  }
  return NextResponse.json({ id, logs, generatedAt: new Date().toISOString() });
}
