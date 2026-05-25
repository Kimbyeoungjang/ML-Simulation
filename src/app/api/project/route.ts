import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatZodError, ProjectFileSchema } from "@/lib/validation";
const dir = path.join(process.cwd(), ".tileforge");
const file = path.join(dir, "project.json");
export async function GET() {
  try { return NextResponse.json(JSON.parse(await readFile(file, "utf8"))); }
  catch { return NextResponse.json({ error: "No saved project" }, { status: 404 }); }
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const project = ProjectFileSchema.parse(body);
    await mkdir(dir, { recursive: true });
    await writeFile(file, JSON.stringify(project, null, 2), "utf8");
    return NextResponse.json({ ok: true, path: ".tileforge/project.json", project });
  } catch (error) {
    return NextResponse.json({ error: "Invalid project", detail: formatZodError(error) }, { status: 400 });
  }
}
