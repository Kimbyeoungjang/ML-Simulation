import { NextResponse } from "next/server";
import { systemStatus } from "@/server/systemStatus";

let cached: { expiresAt: number; payload: ReturnType<typeof systemStatus> } | undefined;

function cacheMs() {
  const parsed = Number(process.env.TILEFORGE_SYSTEM_STATUS_API_CACHE_MS ?? 1000);
  return Math.max(250, Math.min(Number.isFinite(parsed) ? parsed : 1000, 10_000));
}

export async function GET() {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return NextResponse.json({ ...cached.payload, cached: true });
  const payload = systemStatus();
  cached = { payload, expiresAt: now + cacheMs() };
  return NextResponse.json(payload);
}
