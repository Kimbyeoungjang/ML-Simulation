import { NextResponse } from "next/server";
import { estimateAll } from "@/lib/estimator";
import { formatZodError, parseSearchRequest } from "@/lib/validation";
import { apiBodyLimitBytes, bodyLimitErrorResponse, readLimitedJsonBody } from "@/server/requestLimits";
export async function POST(req: Request) {
  try {
    const body = await readLimitedJsonBody(req, apiBodyLimitBytes("TILEFORGE_REPORT_MAX_BODY_BYTES", 4_000_000));
    const res = estimateAll(parseSearchRequest(body));
    return new NextResponse(res.artifacts.reportMarkdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  } catch (error) {
    const tooLarge = bodyLimitErrorResponse(error);
    if (tooLarge) return NextResponse.json(tooLarge, { status: tooLarge.status });
    return NextResponse.json({ error: "Invalid report request", detail: formatZodError(error) }, { status: 400 });
  }
}
