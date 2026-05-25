import { NextResponse } from "next/server";
import { readJobEvents } from "@/server/eventsLog";
import { assertSafeJobId } from "@/server/workspace";

function intQuery(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try { assertSafeJobId(id); } catch { return NextResponse.json({ error: "invalid job id" }, { status: 400 }); }
  const url = new URL(req.url);
  const limit = intQuery(url.searchParams.get("limit"), 500, 1, 5000);
  return NextResponse.json({ id, events: await readJobEvents(id, limit) });
}
