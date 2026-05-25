import { NextResponse } from "next/server";
import { estimateAll } from "@/lib/estimator";
import { buildValidationReport, parseValidationCsv } from "@/lib/verification";
import { apiBodyLimitBytes, bodyLimitErrorResponse, readLimitedJsonBody } from "@/server/requestLimits";

export async function POST(req: Request) {
  try {
    const body = await readLimitedJsonBody<any>(req, apiBodyLimitBytes("TILEFORGE_VALIDATION_MAX_BODY_BYTES", 10_000_000));
    const response = body.response ?? estimateAll(body.request ?? body);
    const samples = body.csv ? parseValidationCsv(String(body.csv)) : (Array.isArray(body.samples) ? body.samples.slice(0, 50_000) : []);
    return NextResponse.json(buildValidationReport(response, samples));
  } catch (error: any) {
    const tooLarge = bodyLimitErrorResponse(error);
    if (tooLarge) return NextResponse.json(tooLarge, { status: tooLarge.status });
    return NextResponse.json({ error: "Invalid validation request", detail: error?.message ?? String(error) }, { status: 400 });
  }
}
