import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { stat } from "node:fs/promises";
import { NextResponse } from "next/server";

export function contentTypeForArtifact(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".csv") return "text/csv; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".log" || ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

export function safeDownloadFileName(rawName: string, fallback = "artifact"): string {
  const base = path.basename(String(rawName || fallback).replace(/\\/g, "/"));
  const cleaned = base.replace(/[\r\n"\\]+/g, "_").replace(/[^A-Za-z0-9가-힣_. -]+/g, "_").trim();
  return cleaned && !/^\.+$/.test(cleaned) ? cleaned.slice(0, 180) : fallback;
}

export function attachmentDisposition(fileName: string): string {
  const safe = safeDownloadFileName(fileName);
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${encoded}"; filename*=UTF-8''${encoded}`;
}

export async function fileDownloadResponse(filePath: string, displayName: string, options: { download?: boolean } = {}): Promise<NextResponse> {
  const st = await stat(filePath);
  if (!st.isFile()) {
    return NextResponse.json({ error: "artifact is not a file" }, { status: 400 });
  }
  const headers: Record<string, string> = {
    "content-type": contentTypeForArtifact(displayName),
    "content-length": String(st.size),
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  };
  if (options.download) headers["content-disposition"] = attachmentDisposition(displayName);
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, { headers });
}

export const __fileResponseForTests = { contentTypeForArtifact, safeDownloadFileName, attachmentDisposition };
