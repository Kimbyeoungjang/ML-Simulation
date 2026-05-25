import { NextResponse } from "next/server";
import { writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runDryRun } from "@/lib/mlirValidate";
import { apiBodyLimitBytes, bodyLimitErrorResponse, boundedInt, boundedStringArray, readLimitedJsonBody, safeUploadBaseName } from "@/server/requestLimits";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const maxBodyBytes = apiBodyLimitBytes("TILEFORGE_DRYRUN_MAX_BODY_BYTES", 2_500_000, 50_000_000);
    const body = await readLimitedJsonBody<any>(req, maxBodyBytes, {});
    const mlir = String(body.mlir ?? "");
    const maxMlirBytes = boundedInt(process.env.TILEFORGE_DRYRUN_MAX_MLIR_BYTES, 2_000_000, 1_024, 50_000_000);
    if (Buffer.byteLength(mlir, "utf8") > maxMlirBytes) {
      return NextResponse.json({ error: "MLIR input is too large", code: "DRYRUN_INPUT_TOO_LARGE", maxMlirBytes }, { status: 413 });
    }
    const dir = await mkdtemp(path.join(os.tmpdir(), "tileforge-dryrun-"));
    const file = path.join(dir, safeUploadBaseName(body.filename, "input.mlir", [".mlir"]));
    await writeFile(file, mlir, "utf8");
    const extraArgs = boundedStringArray(body.extraArgs, [], 32, 240);
    return NextResponse.json(await runDryRun(body.tool === "iree-compile" ? "iree-compile" : "mlir-opt", file, extraArgs));
  } catch (error) {
    const limit = bodyLimitErrorResponse(error);
    if (limit) return NextResponse.json(limit, { status: limit.status });
    return NextResponse.json({ error: "Invalid dry-run request", detail: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
