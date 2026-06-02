import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { jobDir } from "@/server/workspace";

function contentTypeFor(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".vmfb")) return "application/octet-stream";
  return "text/plain; charset=utf-8";
}

function safeContentDispositionName(name: string): string {
  return encodeURIComponent(path.basename(name)).replace(/[()]/g, escape);
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const artifactPath = url.searchParams.get("path");
  if (!artifactPath) {
    return Response.json({ error: "path query parameter is required" }, { status: 400 });
  }
  const root = path.resolve(jobDir(id));
  const target = path.resolve(root, artifactPath);
  if (!target.startsWith(root + path.sep) && target !== root) {
    return Response.json({ error: "invalid artifact path" }, { status: 400 });
  }
  const s = await stat(target).catch(() => null);
  if (!s?.isFile()) return Response.json({ error: "artifact not found" }, { status: 404 });
  const isDownload = url.searchParams.get("download") === "1";
  const maxBytesRaw = Number(url.searchParams.get("maxBytes") ?? 0);
  const maxBytes = Number.isFinite(maxBytesRaw) ? Math.max(0, Math.min(Math.floor(maxBytesRaw), 10 * 1024 * 1024)) : 0;
  const headers: Record<string, string> = {
    "content-type": contentTypeFor(artifactPath),
    "content-length": String(maxBytes > 0 && !isDownload ? Math.min(s.size, maxBytes) : s.size),
    "cache-control": "no-store",
  };
  if (isDownload) {
    headers["content-disposition"] = `attachment; filename*=UTF-8''${safeContentDispositionName(artifactPath)}`;
  }
  if (maxBytes > 0 && !isDownload && s.size > maxBytes) {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const fh = await open(target, "r");
    try {
      await fh.read(buffer, 0, maxBytes, 0);
    } finally {
      await fh.close();
    }
    headers["x-tileforge-truncated"] = "1";
    headers["x-tileforge-original-size"] = String(s.size);
    return new Response(buffer, { headers });
  }
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new Response(stream, { headers });
}
