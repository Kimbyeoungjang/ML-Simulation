import { NextResponse } from "next/server";
import { z } from "zod";
import { sweepArrays } from "@/lib/estimator";
import { estimateMaybeThreaded } from "@/server/threadedEstimate";
import { formatZodError, parseSearchRequest } from "@/lib/validation";
import { readEstimateCache, writeEstimateCache } from "@/lib/cache";
import { applyEstimatorSuiteToSearchResponse } from "@/lib/estimatorSuiteApply";
import { readActiveEstimatorSuiteModel } from "@/server/activeEstimatorSuite";

const arraySweepSchema = z.array(z.object({ rows: z.number().int().positive(), cols: z.number().int().positive() })).max(128).optional();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = parseSearchRequest(body);
    const arrays = arraySweepSchema.parse(body.arraySweep);
    const cached = await readEstimateCache(parsed);
    const baseResponse = cached ?? await estimateMaybeThreaded(parsed);
    if (!cached) await writeEstimateCache(parsed, baseResponse);
    const activeModel = await readActiveEstimatorSuiteModel();
    const response = applyEstimatorSuiteToSearchResponse(baseResponse, activeModel);
    const arraySweepBase = arrays ? sweepArrays({ baseHardware: parsed.hardware, shapes: parsed.shapes, candidates: parsed.candidates, arrays, objective: parsed.objective }) : undefined;
    const arraySweep = arraySweepBase?.map(row => ({ ...row, note: response.estimatorSuite?.applied ? "main estimate uses active Estimator Suite; array sweep remains analytical baseline" : undefined }));
    return NextResponse.json({ ...response, arraySweep, cache: { hit: Boolean(cached) } });
  } catch (error) {
    return NextResponse.json({ error: "Invalid estimate request", code: "VALIDATION_ERROR", detail: formatZodError(error) }, { status: 400 });
  }
}
