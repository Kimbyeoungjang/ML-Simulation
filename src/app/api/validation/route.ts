import { NextResponse } from "next/server";
import { estimateAll } from "@/lib/estimator";
import { buildValidationReport, parseValidationCsv } from "@/lib/verification";
export async function POST(req: Request) {
  const body = await req.json();
  const response = body.response ?? estimateAll(body.request ?? body);
  const samples = body.csv ? parseValidationCsv(String(body.csv)) : (body.samples ?? []);
  return NextResponse.json(buildValidationReport(response, samples));
}
