import { NextResponse } from "next/server";
import { z } from "zod";
import { sweepArrays } from "@/lib/estimator";
import { estimateMaybeThreaded } from "@/server/threadedEstimate";
import { formatZodError, parseSearchRequest } from "@/lib/validation";
import { readEstimateCache, writeEstimateCache } from "@/lib/cache";
import { apiBodyLimitBytes, bodyLimitErrorResponse, readLimitedJsonBody } from "@/server/requestLimits";

const arraySweepSchema = z.array(z.object({ rows: z.number().int().positive(), cols: z.number().int().positive() })).max(128).optional();

export async function POST(request: Request) {
  try {
    const body = await readLimitedJsonBody<any>(request, apiBodyLimitBytes("TILEFORGE_ESTIMATE_MAX_BODY_BYTES", 4_000_000));
    const parsed = parseSearchRequest(body);
    const arrays = arraySweepSchema.parse(body.arraySweep);
    const cached = await readEstimateCache(parsed);
    const response = cached ?? await estimateMaybeThreaded(parsed);
    if (!cached) await writeEstimateCache(parsed, response);
    const arraySweep = arrays ? sweepArrays({ baseHardware: parsed.hardware, shapes: parsed.shapes, candidates: parsed.candidates, arrays, objective: parsed.objective }) : undefined;
    return NextResponse.json({ ...response, arraySweep, cache: { hit: Boolean(cached) } });
  } catch (error) {
    const tooLarge = bodyLimitErrorResponse(error);
    if (tooLarge) return NextResponse.json(tooLarge, { status: tooLarge.status });
    return NextResponse.json({ error: "Invalid estimate request", code: "VALIDATION_ERROR", detail: formatZodError(error) }, { status: 400 });
  }
}
