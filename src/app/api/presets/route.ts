import { NextResponse } from "next/server";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@/server/atomic";
import { apiBodyLimitBytes, bodyLimitErrorResponse, readLimitedJsonBody } from "@/server/requestLimits";

const PRESET_ROOT = path.join(process.cwd(), "presets");
const DEFAULT_DIR = path.join(PRESET_ROOT, "default");
const USER_DIR = path.join(PRESET_ROOT, "user");
const HARDWARE_DIR = path.join(PRESET_ROOT, "hardware");
const WORKLOAD_DIR = path.join(PRESET_ROOT, "workload");

function safePresetName(name: string, fallback = "preset"): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9가-힣_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120);
  if (!cleaned || cleaned === "." || cleaned === ".." || /^\.+$/.test(cleaned)) return fallback;
  return cleaned;
}

function parsePresetKind(value: unknown): "user" | "hardware" | "workload" {
  return value === "hardware" || value === "workload" ? value : "user";
}


async function presetNameExists(dir: string, name: string): Promise<boolean> {
  await mkdir(dir, { recursive: true });
  const safe = safePresetName(name);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => entry.isFile() && entry.name.replace(/\.json$/, "") === safe);
}

async function readPresetDir(dir: string, source: string) {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const presets: any[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const data = JSON.parse(await readFile(path.join(dir, entry.name), "utf8"));
      presets.push({ ...data, name: data.name ?? entry.name.replace(/\.json$/, ""), source, fileName: entry.name });
    } catch {}
  }
  return presets;
}

export async function GET() {
  const presets = [
    ...(await readPresetDir(DEFAULT_DIR, "default")),
    ...(await readPresetDir(USER_DIR, "user")),
  ].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const hardwarePresets = (await readPresetDir(HARDWARE_DIR, "hardware")).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const workloadPresets = (await readPresetDir(WORKLOAD_DIR, "workload")).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return NextResponse.json({ presets, hardwarePresets, workloadPresets });
}

export async function POST(req: Request) {
  let body: any;
  try { body = await readLimitedJsonBody(req, apiBodyLimitBytes("TILEFORGE_PRESET_MAX_BODY_BYTES", 2_000_000), {}); }
  catch (error) {
    const limit = bodyLimitErrorResponse(error);
    if (limit) return NextResponse.json(limit, { status: limit.status });
    return NextResponse.json({ error: "Invalid preset request" }, { status: 400 });
  }
  const kind = parsePresetKind(body.kind);
  const name = safePresetName(String(body.name ?? "preset"));
  const savedAt = body.savedAt ?? new Date().toISOString();

  if (kind === "user" && await presetNameExists(DEFAULT_DIR, name)) {
    return NextResponse.json({ error: `사용자 프리셋 이름 '${name}'은 기본 프리셋과 겹칩니다. 다른 이름을 사용하세요.` }, { status: 409 });
  }

  if (kind === "hardware") {
    if (!body.hardware) return NextResponse.json({ error: "hardware is required" }, { status: 400 });
    await mkdir(HARDWARE_DIR, { recursive: true });
    const preset = { kind, name, hardware: { ...body.hardware, name: body.hardware.name ?? name }, savedAt, source: "hardware" };
    await atomicWriteFile(path.join(HARDWARE_DIR, `${name}.json`), JSON.stringify(preset, null, 2));
    return NextResponse.json({ ok: true, preset });
  }

  if (kind === "workload") {
    if (!Array.isArray(body.shapes)) return NextResponse.json({ error: "shapes array is required" }, { status: 400 });
    await mkdir(WORKLOAD_DIR, { recursive: true });
    const preset = { kind, name, shapes: body.shapes, savedAt, source: "workload" };
    await atomicWriteFile(path.join(WORKLOAD_DIR, `${name}.json`), JSON.stringify(preset, null, 2));
    return NextResponse.json({ ok: true, preset });
  }

  const preset = { ...body, name, source: "user", savedAt };
  await mkdir(USER_DIR, { recursive: true });
  await atomicWriteFile(path.join(USER_DIR, `${name}.json`), JSON.stringify(preset, null, 2));
  return NextResponse.json({ ok: true, preset });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const rawName = url.searchParams.get("name");
  if (!rawName?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const name = safePresetName(rawName, "");
  if (!name) return NextResponse.json({ error: "invalid preset name" }, { status: 400 });
  const kind = parsePresetKind(url.searchParams.get("kind"));
  const dir = kind === "hardware" ? HARDWARE_DIR : kind === "workload" ? WORKLOAD_DIR : USER_DIR;
  await rm(path.join(dir, `${name}.json`), { force: true });
  return NextResponse.json({ ok: true, kind, name });
}
