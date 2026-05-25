export class RequestBodyTooLargeError extends Error {
  readonly status = 413;
  constructor(readonly maxBytes: number) {
    super(`Request body is too large; max ${maxBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

export function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

export function boundedFloat(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

export function envBoundedInt(name: string, fallback: number, min: number, max: number): number {
  return boundedInt(process.env[name], fallback, min, max);
}

export function apiBodyLimitBytes(envName: string, fallbackBytes: number, maxBytes = 50_000_000): number {
  return envBoundedInt(envName, fallbackBytes, 1_024, maxBytes);
}

export function contentLengthTooLarge(req: Request, maxBytes: number): boolean {
  const raw = req.headers.get("content-length");
  if (!raw) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > maxBytes;
}

export function assertContentLengthWithin(req: Request, maxBytes: number): void {
  if (contentLengthTooLarge(req, maxBytes)) throw new RequestBodyTooLargeError(maxBytes);
}

export async function readLimitedTextBody(req: Request, maxBytes: number): Promise<string> {
  assertContentLengthWithin(req, maxBytes);
  if (!req.body) {
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
    return text;
  }

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError(maxBytes);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export async function readLimitedJsonBody<T = any>(req: Request, maxBytes: number, fallback?: T): Promise<T> {
  const text = await readLimitedTextBody(req, maxBytes);
  if (!text.trim()) {
    if (fallback !== undefined) return fallback;
    throw new SyntaxError("Empty JSON body");
  }
  return JSON.parse(text) as T;
}

export function bodyLimitErrorResponse(error: unknown): { error: string; code: string; maxBytes: number; status: number } | undefined {
  if (!(error instanceof RequestBodyTooLargeError)) return undefined;
  return { error: "Request body is too large", code: "REQUEST_BODY_TOO_LARGE", maxBytes: error.maxBytes, status: error.status };
}

export function safeUploadBaseName(name: unknown, fallback: string, allowedExtensions?: string[]): string {
  const fallbackBase = String(fallback || "upload").replace(/\\/g, "/").split("/").pop()?.trim() || "upload";
  const raw = String(name ?? fallbackBase).replace(/\\/g, "/").split("/").pop()?.trim() || fallbackBase;
  let cleaned = raw.replace(/[^A-Za-z0-9가-힣_.-]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === ".." || /^\.+$/.test(cleaned)) cleaned = fallbackBase;
  cleaned = cleaned.slice(0, 180);
  const lower = cleaned.toLowerCase();
  if (allowedExtensions?.length && !allowedExtensions.some((ext) => lower.endsWith(ext.toLowerCase()))) {
    const ext = allowedExtensions[0] ?? "";
    const stem = cleaned.replace(/\.[^.]+$/, "") || fallbackBase.replace(/\.[^.]+$/, "") || "upload";
    return `${stem.slice(0, Math.max(1, 180 - ext.length))}${ext}`;
  }
  return cleaned;
}

export function boundedStringArray(value: unknown, fallback: string[] = [], maxItems = 32, maxLength = 240): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .slice(0, maxItems)
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .map((item) => item.slice(0, maxLength));
}

export const __requestLimitsForTests = {
  boundedInt,
  boundedFloat,
  envBoundedInt,
  apiBodyLimitBytes,
  safeUploadBaseName,
  boundedStringArray,
  contentLengthTooLarge,
  assertContentLengthWithin,
  readLimitedTextBody,
  readLimitedJsonBody,
};
