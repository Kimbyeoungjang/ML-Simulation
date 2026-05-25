import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { formatZodError, ProjectFileSchema } from "@/lib/validation";
import { atomicWriteFile } from "@/server/atomic";
import { apiBodyLimitBytes, bodyLimitErrorResponse, readLimitedJsonBody } from "@/server/requestLimits";
import { ensureWorkspaceRoot, getWorkspaceRoot } from "@/server/workspace";
function projectFile() { return path.join(getWorkspaceRoot(), "project.json"); }
export async function GET() {
  try { return NextResponse.json(ProjectFileSchema.parse(JSON.parse(await readFile(projectFile(), "utf8")))); }
  catch { return NextResponse.json({ error: "No saved project" }, { status: 404 }); }
}
export async function POST(req: Request) {
  try {
    const body = await readLimitedJsonBody(req, apiBodyLimitBytes("TILEFORGE_PROJECT_MAX_BODY_BYTES", 4_000_000));
    const project = ProjectFileSchema.parse(body);
    await ensureWorkspaceRoot();
    await atomicWriteFile(projectFile(), JSON.stringify(project, null, 2));
    return NextResponse.json({ ok: true, path: ".tileforge/project.json", project });
  } catch (error) {
    const limit = bodyLimitErrorResponse(error);
    if (limit) return NextResponse.json(limit, { status: limit.status });
    return NextResponse.json({ error: "Invalid project", detail: formatZodError(error) }, { status: 400 });
  }
}
