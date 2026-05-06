import { NextRequest, NextResponse } from "next/server";
import { parseOnnxBuffer, parseOnnxShapeJson } from "@/lib/onnx";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const text = JSON.stringify(await req.json());
      return NextResponse.json({ shapes: parseOnnxShapeJson(text), warnings: [], nodesSeen: 0, initializersSeen: 0 });
    }
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "missing file" }, { status: 400 });
    const name = file.name.replace(/\.(onnx|json)$/i, "") || "onnx-model";
    const buf = await file.arrayBuffer();
    if (file.name.endsWith(".json")) return NextResponse.json({ shapes: parseOnnxShapeJson(Buffer.from(buf).toString("utf-8")), warnings: [], nodesSeen: 0, initializersSeen: 0 });
    return NextResponse.json(await parseOnnxBuffer(buf, name));
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
