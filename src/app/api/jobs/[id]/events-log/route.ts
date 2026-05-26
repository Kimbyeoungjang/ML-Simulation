import { NextResponse } from "next/server";
import { readJobEvents } from "@/server/eventsLog";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 500);
  return NextResponse.json({ id, events: await readJobEvents(id, Math.min(Math.max(limit, 1), 5000)) });
}
