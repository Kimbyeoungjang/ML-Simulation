import { NextRequest, NextResponse } from "next/server";
import { parseMeasurementCsv } from "@/lib/calibration";
import { apiBodyLimitBytes, bodyLimitErrorResponse, boundedFloat, readLimitedJsonBody } from "@/server/requestLimits";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const body = await readLimitedJsonBody<{ text?: unknown; frequencyMHz?: unknown }>(req, apiBodyLimitBytes("TILEFORGE_CALIBRATION_MAX_BODY_BYTES", 5_000_000));
    const frequencyMHz = boundedFloat(body.frequencyMHz, 1000, 1, 1_000_000);
    return NextResponse.json(parseMeasurementCsv(String(body.text ?? ""), frequencyMHz));
  } catch (e: any) {
    const tooLarge = bodyLimitErrorResponse(e);
    if (tooLarge) return NextResponse.json(tooLarge, { status: tooLarge.status });
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
