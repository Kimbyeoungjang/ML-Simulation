import { NextRequest, NextResponse } from "next/server";
import { readProjectDotEnv, upsertProjectDotEnv } from "@/server/env";

const allowedKeys = [
  "TILEFORGE_WEB_PORT",
  "TILEFORGE_WEB_HOST",
  "NEXT_PUBLIC_TILEFORGE_API_BASE_URL",
  "TILEFORGE_SCALE_SIM_CMD",
  "TILEFORGE_IREE_COMPILE_CMD",
  "TILEFORGE_MAX_PARALLEL_JOBS",
  "TILEFORGE_WORKSPACE_DIR",
  "TILEFORGE_JOB_STORE",
  "TILEFORGE_CACHE_DIR",
  "TILEFORGE_EXTERNAL_TIMEOUT_MS",
  "TILEFORGE_ENABLE_TPU_WEB_RUN",
  "TILEFORGE_TPU_WEB_TIMEOUT_MS",
];

function currentValues() {
  const envFile = readProjectDotEnv();
  const values: Record<string, string> = {};
  for (const key of allowedKeys) values[key] = envFile[key] ?? process.env[key] ?? "";
  return values;
}

export async function GET() {
  return NextResponse.json({ ok: true, keys: allowedKeys, values: currentValues() });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const incoming = body?.values ?? {};
  const values: Record<string, string> = {};
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(incoming, key)) values[key] = String(incoming[key] ?? "");
  }
  const result = upsertProjectDotEnv(values, process.cwd(), { overwrite: true });
  return NextResponse.json({ ok: true, ...result, keys: allowedKeys, values: currentValues() });
}
