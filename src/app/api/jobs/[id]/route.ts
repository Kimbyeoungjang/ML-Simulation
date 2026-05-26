import { NextResponse } from "next/server";
import { deleteJob, readJob, requestCancel } from "@/server/jobStore";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(await readJob(id));
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body.action === "cancel") return NextResponse.json(await requestCancel(id));
  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteJob(id);
  return NextResponse.json({ ok: true, id });
}
