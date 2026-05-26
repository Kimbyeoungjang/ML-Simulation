import { NextRequest, NextResponse } from "next/server";
import { parseMeasurementCsv } from "@/lib/calibration";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const { text, frequencyMHz } = await req.json();
    return NextResponse.json(parseMeasurementCsv(String(text ?? ""), Number(frequencyMHz ?? 1000)));
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
