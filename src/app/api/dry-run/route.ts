import { NextResponse } from "next/server";
import { writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDryRun } from "@/lib/mlirValidate";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const body = await req.json();
  const dir = await mkdtemp(path.join(os.tmpdir(), "tileforge-dryrun-"));
  const file = path.join(dir, body.filename ?? "input.mlir");
  await writeFile(file, String(body.mlir ?? ""), "utf8");
  return NextResponse.json(await runDryRun(body.tool === "iree-compile" ? "iree-compile" : "mlir-opt", file, body.extraArgs ?? []));
}
