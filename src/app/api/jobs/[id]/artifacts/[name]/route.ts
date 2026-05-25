import { NextResponse } from "next/server";
import path from "node:path";
import { jobArtifactPath } from "@/server/workspace";
import { fileDownloadResponse } from "@/server/fileResponse";

export async function GET(_: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  try {
    const { id, name } = await ctx.params;
    const safeName = path.basename(name);
    const target = jobArtifactPath(id, safeName);
    return await fileDownloadResponse(target, safeName);
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const status = message.includes("Invalid") || message.includes("Internal") || message.includes("escapes") ? 400 : 404;
    return NextResponse.json({ error: status === 400 ? "invalid artifact path" : "artifact not found" }, { status });
  }
}
