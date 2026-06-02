import { open, stat } from "node:fs/promises";

export async function readTextTail(file: string, maxChars = 4000): Promise<{ text: string; bytes: number; updatedAt?: string }> {
  const s = await stat(file);
  const safeMaxChars = Math.max(1, Math.floor(maxChars));
  // UTF-8 can use up to 4 bytes per code point. Read a bounded byte window from
  // the end of the file instead of loading multi-MiB external logs into memory.
  const maxBytes = Math.min(s.size, Math.max(4096, safeMaxChars * 4));
  if (maxBytes <= 0) return { text: "", bytes: s.size, updatedAt: s.mtime.toISOString() };
  const buffer = Buffer.allocUnsafe(maxBytes);
  const fh = await open(file, "r");
  try {
    await fh.read(buffer, 0, maxBytes, Math.max(0, s.size - maxBytes));
  } finally {
    await fh.close();
  }
  const text = buffer.toString("utf8");
  return {
    text: text.length > safeMaxChars ? text.slice(-safeMaxChars) : text,
    bytes: s.size,
    updatedAt: s.mtime.toISOString(),
  };
}
