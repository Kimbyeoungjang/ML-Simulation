import { NextRequest, NextResponse } from "next/server";
import { parseOnnxBuffer, parseOnnxShapeJson } from "@/lib/onnx";
import { apiBodyLimitBytes, assertContentLengthWithin, bodyLimitErrorResponse, boundedInt, readLimitedTextBody, safeUploadBaseName } from "@/server/requestLimits";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const maxUploadBytes = boundedInt(process.env.TILEFORGE_MAX_ONNX_UPLOAD_MB, 128, 1, 2048) * 1024 * 1024;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const text = await readLimitedTextBody(req, apiBodyLimitBytes("TILEFORGE_ONNX_JSON_MAX_BODY_BYTES", 8_000_000, 50_000_000));
      return NextResponse.json({ shapes: parseOnnxShapeJson(text), warnings: [], nodesSeen: 0, initializersSeen: 0 });
    }
    assertContentLengthWithin(req, maxUploadBytes);
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "missing file" }, { status: 400 });
    if (file.size > maxUploadBytes) {
      return NextResponse.json({ error: "ONNX file is too large", code: "ONNX_UPLOAD_TOO_LARGE", maxUploadBytes }, { status: 413 });
    }
    const safeFileName = safeUploadBaseName(file.name, "onnx-model.onnx", [".onnx", ".json"]);
    const name = safeFileName.replace(/\.(onnx|json)$/i, "") || "onnx-model";
    const buf = await file.arrayBuffer();
    if (safeFileName.toLowerCase().endsWith(".json")) return NextResponse.json({ shapes: parseOnnxShapeJson(Buffer.from(buf).toString("utf-8")), warnings: [], nodesSeen: 0, initializersSeen: 0 });
    return NextResponse.json(await parseOnnxBuffer(buf, name));
  } catch (error: any) {
    const limit = bodyLimitErrorResponse(error);
    if (limit) return NextResponse.json(limit, { status: limit.status });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
