import os from "node:os";
import type { SearchRequest, SearchResponse } from "@/types/domain";
import { MANIFEST_SCHEMA_VERSION } from "./schemas";
export function makeManifest(req: SearchRequest, res?: Pick<SearchResponse,"summary">) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    toolVersion: "0.7.0",
    createdAt: new Date().toISOString(),
    hardware: req.hardware,
    shapes: req.shapes,
    candidates: req.candidates,
    objective: req.objective,
    summary: res?.summary,
    externalTools: { scalesim: process.env.TILEFORGE_SCALE_SIM_CMD ?? null, ireeCompile: process.env.TILEFORGE_IREE_COMPILE_CMD ?? null, mlirOpt: process.env.TILEFORGE_MLIR_OPT_CMD ?? null },
    environment: { node: process.version, platform: process.platform, arch: process.arch, hostname: os.hostname() }
  };
}
