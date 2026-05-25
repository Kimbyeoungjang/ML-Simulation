import { NextResponse } from "next/server";
import { deleteJob, readJob, requestCancel } from "@/server/jobStore";
import { apiBodyLimitBytes, bodyLimitErrorResponse, readLimitedJsonBody } from "@/server/requestLimits";

function apiError(error: unknown) {
  const message = String((error as Error)?.message ?? error);
  if (message.includes("Invalid job id")) return NextResponse.json({ error: "invalid job id" }, { status: 400 });
  if (message.includes("ENOENT") || message.includes("no such file")) return NextResponse.json({ error: "job not found" }, { status: 404 });
  return NextResponse.json({ error: "job operation failed" }, { status: 500 });
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json(await readJob(id));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readLimitedJsonBody<any>(req, apiBodyLimitBytes("TILEFORGE_JOB_PATCH_MAX_BODY_BYTES", 64_000), {});
    if (body.action === "cancel") return NextResponse.json(await requestCancel(id));
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    const limit = bodyLimitErrorResponse(error);
    if (limit) return NextResponse.json(limit, { status: limit.status });
    return apiError(error);
  }
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    await deleteJob(id);
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return apiError(error);
  }
}
