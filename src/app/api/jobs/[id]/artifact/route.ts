import { NextResponse } from "next/server";
import { jobArtifactPath } from "@/server/workspace";
import { fileDownloadResponse } from "@/server/fileResponse";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const artifactPath = url.searchParams.get("path");
    if (!artifactPath) {
      return NextResponse.json({ error: "path query parameter is required" }, { status: 400 });
    }
    const target = jobArtifactPath(id, artifactPath);
    return await fileDownloadResponse(target, artifactPath, { download: url.searchParams.get("download") === "1" });
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const status = message.includes("Invalid") || message.includes("escapes") ? 400 : 404;
    return NextResponse.json({ error: status === 400 ? "invalid artifact path" : "artifact not found" }, { status });
  }
}
