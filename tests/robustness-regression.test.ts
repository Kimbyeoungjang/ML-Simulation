import { describe, expect, it, afterEach } from "vitest";
import path from "node:path";
import { parseCsvRecords, parseShapesCsv, shapesToCsv } from "@/lib/csv";
import { quotaConfig } from "@/lib/quotas";
import { assertSafeJobId, isPublicArtifactPath, jobArtifactPath, resolveInside } from "@/server/workspace";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { appendJobEvent, readJobEvents } from "@/server/eventsLog";

describe("CSV robustness", () => {
  it("parses quoted cells, BOM, comments, and thousands separators", () => {
    const rows = parseShapesCsv('\uFEFF# comment\nid,model,op_name,m,n,k,dtype_bytes\n"a,1","ViT, small","q,k", "1,024",512,256,2\n');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("a,1");
    expect(rows[0].model).toBe("ViT, small");
    expect(rows[0].opName).toBe("q,k");
    expect(rows[0].m).toBe(1024);
  });


  it("parses shared CSV records with multiline quoted cells and comments", () => {
    const rows = parseCsvRecords('\uFEFF# ignore\nLayer Name,Total Cycles (incl. prefetch),Note\n"layer\n1","72,951","hello, csv"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]["Layer Name"]).toBe("layer\n1");
    expect(rows[0]["Total Cycles (incl. prefetch)"]).toBe("72,951");
    expect(rows[0].Note).toBe("hello, csv");
  });

  it("escapes shape names on export", () => {
    const csv = shapesToCsv([{ id: "a,1", model: "m", opName: 'op "x"', m: 1, n: 2, k: 3, dtypeBytes: 2, source: "manual" }]);
    expect(csv).toContain('"a,1"');
    expect(csv).toContain('"op ""x"""');
  });
});

describe("workspace path guards", () => {
  it("rejects unsafe job ids and artifact traversal", () => {
    expect(() => assertSafeJobId("../bad")).toThrow();
    expect(() => assertSafeJobId("a/b")).toThrow();
    expect(() => jobArtifactPath("job_123", "../secret.txt")).toThrow();
    expect(() => jobArtifactPath("job_123", "job.json")).toThrow();
    expect(isPublicArtifactPath("report.md")).toBe(true);
    expect(isPublicArtifactPath("nested/report.md")).toBe(true);
    expect(isPublicArtifactPath("events.ndjson")).toBe(false);
    expect(isPublicArtifactPath(".tmp")).toBe(false);
  });

  it("keeps resolved paths inside their root", () => {
    const root = path.join(process.cwd(), ".tileforge", "jobs", "job_123");
    expect(resolveInside(root, "a", "b.txt")).toContain(path.join("a", "b.txt"));
    expect(() => resolveInside(root, "..", "outside.txt")).toThrow();
  });
});

describe("quota env fallback", () => {
  const keys = ["TILEFORGE_MAX_QUEUED_JOBS", "TILEFORGE_MAX_BUNDLE_MB", "TILEFORGE_MAX_CANDIDATES"];
  afterEach(() => { for (const key of keys) delete process.env[key]; });

  it("clamps invalid or extreme quota values", () => {
    process.env.TILEFORGE_MAX_QUEUED_JOBS = "NaN";
    process.env.TILEFORGE_MAX_BUNDLE_MB = "-10";
    process.env.TILEFORGE_MAX_CANDIDATES = "999999999999";
    const cfg = quotaConfig();
    expect(cfg.maxQueuedJobs).toBe(100);
    expect(cfg.maxBundleMB).toBe(1);
    expect(cfg.maxCandidates).toBe(50_000_000);
  });
});


describe("structured event log robustness", () => {
  const previousRoot = process.env.TILEFORGE_JOB_ROOT;
  let tempRoot: string | undefined;
  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
    if (previousRoot === undefined) delete process.env.TILEFORGE_JOB_ROOT;
    else process.env.TILEFORGE_JOB_ROOT = previousRoot;
  });

  it("skips corrupt NDJSON lines instead of dropping the whole event log", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileforge-events-"));
    const root = tempRoot;
    process.env.TILEFORGE_JOB_ROOT = root;
    const dir = path.join(root, "job_123");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "events.ndjson"), [
      JSON.stringify({ time: "2026-01-01T00:00:00.000Z", level: "info", jobId: "job_123", message: "first" }),
      "{not json}",
      JSON.stringify({ time: "2026-01-01T00:00:01.000Z", level: "warn", jobId: "job_123", message: "second" }),
    ].join("\n"));

    const events = await readJobEvents("job_123", Number.NaN);
    expect(events.map((e) => e.message)).toEqual(["first", "second"]);
  });

  it("tails large NDJSON event logs instead of requiring the full file", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileforge-events-tail-"));
    process.env.TILEFORGE_JOB_ROOT = tempRoot;
    process.env.TILEFORGE_EVENT_TAIL_BYTES = "64000";
    const dir = path.join(tempRoot, "job_123");
    await mkdir(dir, { recursive: true });
    const oldLines = Array.from({ length: 2000 }, (_, i) => JSON.stringify({ time: `2026-01-01T00:00:00.${String(i % 1000).padStart(3, "0")}Z`, level: "info", jobId: "job_123", message: `old-${i}` }));
    await writeFile(path.join(dir, "events.ndjson"), oldLines.join("\n") + "\n" + JSON.stringify({ time: "2026-01-01T00:00:02.000Z", level: "info", jobId: "job_123", message: "latest" }) + "\n");

    const events = await readJobEvents("job_123", 1);
    expect(events.map((e) => e.message)).toEqual(["latest"]);
    delete process.env.TILEFORGE_EVENT_TAIL_BYTES;
  });

  it("truncates oversized event data and survives circular payloads", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileforge-events-data-"));
    process.env.TILEFORGE_JOB_ROOT = tempRoot;
    process.env.TILEFORGE_EVENT_DATA_MAX_BYTES = "1024";
    await appendJobEvent("job_123", { level: "info", message: "huge", data: { text: "x".repeat(5000) } });
    const circular: any = { label: "circle" };
    circular.self = circular;
    await appendJobEvent("job_123", { level: "warn", message: "circular", data: circular });

    const events = await readJobEvents("job_123", 10);
    expect((events[0].data as any).truncated).toBe(true);
    expect((events[1].data as any).unserializable).toBe(true);
    delete process.env.TILEFORGE_EVENT_DATA_MAX_BYTES;
  });

});

import { __requestLimitsForTests } from "@/server/requestLimits";

describe("request limit helpers", () => {
  it("clamps numeric request parameters", () => {
    expect(__requestLimitsForTests.boundedInt("NaN", 30, 1, 3650)).toBe(30);
    expect(__requestLimitsForTests.boundedInt("-5", 30, 1, 3650)).toBe(1);
    expect(__requestLimitsForTests.boundedInt("99999", 30, 1, 3650)).toBe(3650);
  });

  it("normalizes upload filenames and bounded argument arrays", () => {
    expect(__requestLimitsForTests.safeUploadBaseName("../bad/name.txt", "input.mlir", [".mlir"])).toBe("name.mlir");
    expect(__requestLimitsForTests.boundedStringArray(["--pass", "x".repeat(500)], [], 4, 10)).toEqual(["--pass", "xxxxxxxxxx"]);
  });
});

describe("nested artifact and filename hardening", () => {
  it("blocks hidden/internal path segments, not just the basename", () => {
    expect(isPublicArtifactPath("nested/.secret/report.md")).toBe(false);
    expect(isPublicArtifactPath("nested/job.json/report.md")).toBe(false);
    expect(isPublicArtifactPath("nested/report.md.tmp/ok.txt")).toBe(false);
    expect(isPublicArtifactPath("nested/report.md")).toBe(true);
  });

  it("does not return dot-only upload basenames", () => {
    expect(__requestLimitsForTests.safeUploadBaseName(".", "input.mlir", [".mlir"])).toBe("input.mlir");
    expect(__requestLimitsForTests.safeUploadBaseName("..", "input.mlir", [".mlir"])).toBe("input.mlir");
  });
});

describe("artifact integrity manifest hardening", () => {
  const previousRoot = process.env.TILEFORGE_JOB_ROOT;
  let tempRoot: string | undefined;
  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
    if (previousRoot === undefined) delete process.env.TILEFORGE_JOB_ROOT;
    else process.env.TILEFORGE_JOB_ROOT = previousRoot;
  });

  it("does not trust manifest path fields outside the job directory", async () => {
    const { verifyJobIntegrityFromManifest } = await import("@/server/artifactIntegrity");
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileforge-integrity-"));
    process.env.TILEFORGE_JOB_ROOT = tempRoot;
    const dir = path.join(tempRoot, "job_123");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "report.md"), "safe report");
    await writeFile(path.join(dir, "artifact_integrity.json"), JSON.stringify({ artifacts: [{ name: "../outside.txt", path: "/etc/passwd", sizeBytes: 1, sha256: "x" }] }));
    const result = await verifyJobIntegrityFromManifest("job_123");
    expect(result.ok).toBe(false);
    expect(result.failures[0]?.name).toBe("../outside.txt");
  });
});

import { safeZipEntryName } from "@/lib/zip";

describe("bundle and zip memory-safety guards", () => {
  afterEach(() => { delete process.env.TILEFORGE_MAX_BUNDLE_FILES; });

  it("clamps bundle file count env values", async () => {
    process.env.TILEFORGE_MAX_BUNDLE_FILES = "999999";
    const { __bundleRouteForTests } = await import("@/app/api/jobs/[id]/bundle/route");
    expect(__bundleRouteForTests.maxBundleFiles()).toBe(5000);
    process.env.TILEFORGE_MAX_BUNDLE_FILES = "NaN";
    expect(__bundleRouteForTests.maxBundleFiles()).toBe(500);
  });

  it("sanitizes zip entry names to avoid absolute paths and backslash traversal", () => {
    expect(safeZipEntryName("../outside.txt")).toBe("outside.txt");
    expect(safeZipEntryName("C:\\temp\\evil.txt")).toBe("temp/evil.txt");
    expect(safeZipEntryName("/abs/path/report.md")).toBe("abs/path/report.md");
    expect(safeZipEntryName("...")).toBe("_");
  });
});

describe("limited request body parsing", () => {
  afterEach(() => { delete process.env.TILEFORGE_TEST_BODY_LIMIT; });

  it("rejects oversized JSON bodies before full API processing", async () => {
    const body = JSON.stringify({ text: "x".repeat(64) });
    const req = new Request("http://tileforge.local/api/test", { method: "POST", body, headers: { "content-type": "application/json" } });
    await expect(__requestLimitsForTests.readLimitedJsonBody(req, 32)).rejects.toThrow(/too large/i);
  });

  it("clamps API body limit environment values", () => {
    process.env.TILEFORGE_TEST_BODY_LIMIT = "999999999";
    expect(__requestLimitsForTests.apiBodyLimitBytes("TILEFORGE_TEST_BODY_LIMIT", 1024, 2048)).toBe(2048);
    process.env.TILEFORGE_TEST_BODY_LIMIT = "NaN";
    expect(__requestLimitsForTests.apiBodyLimitBytes("TILEFORGE_TEST_BODY_LIMIT", 1024, 2048)).toBe(1024);
  });
});

import { __fileResponseForTests } from "@/server/fileResponse";
import { readFile } from "node:fs/promises";
import { cacheKey, readEstimateCache, writeEstimateCache } from "@/lib/cache";
import { estimateAll } from "@/lib/estimator";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";

describe("artifact download response helpers", () => {
  it("uses safe content types and attachment filenames", () => {
    expect(__fileResponseForTests.contentTypeForArtifact("report.html")).toBe("text/html; charset=utf-8");
    expect(__fileResponseForTests.contentTypeForArtifact("model.vmfb")).toBe("application/octet-stream");
    expect(__fileResponseForTests.safeDownloadFileName('../bad\nname".csv')).toBe("bad_name_.csv");
    expect(__fileResponseForTests.attachmentDisposition('bad\r\nname.csv')).toContain("filename*=UTF-8''bad_name.csv");
  });
});

describe("estimate cache resilience", () => {
  const previousRoot = process.env.TILEFORGE_WORKSPACE_ROOT;
  let tempRoot: string | undefined;
  afterEach(async () => {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
    if (previousRoot === undefined) delete process.env.TILEFORGE_WORKSPACE_ROOT;
    else process.env.TILEFORGE_WORKSPACE_ROOT = previousRoot;
    delete process.env.TILEFORGE_DISABLE_CACHE;
  });

  it("atomically writes valid responses and evicts corrupt cache hits", async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "tileforge-cache-"));
    process.env.TILEFORGE_WORKSPACE_ROOT = tempRoot;
    const req = { hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" as const };
    const res = estimateAll(req);
    await writeEstimateCache(req, res);
    expect((await readEstimateCache(req))?.summary.totalCycles).toBe(res.summary.totalCycles);

    const cacheFile = path.join(tempRoot, "cache", cacheKey(req), "result.json");
    await writeFile(cacheFile, JSON.stringify({ summary: { totalCycles: null }, results: [] }), "utf8");
    expect(await readEstimateCache(req)).toBeUndefined();
    await expect(readFile(cacheFile, "utf8")).rejects.toThrow();
  });
});


describe("large body guards on utility APIs", () => {
  afterEach(() => {
    delete process.env.TILEFORGE_DRYRUN_MAX_BODY_BYTES;
    delete process.env.TILEFORGE_ONNX_JSON_MAX_BODY_BYTES;
  });

  it("rejects oversized dry-run JSON before invoking external tools", async () => {
    process.env.TILEFORGE_DRYRUN_MAX_BODY_BYTES = "1024";
    const { POST } = await import("@/app/api/dry-run/route");
    const body = JSON.stringify({ mlir: "module {" + "x".repeat(2048) });
    const res = await POST(new Request("http://tileforge.local/api/dry-run", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
    }));
    expect(res.status).toBe(413);
  });

  it("rejects oversized ONNX shape JSON before parsing", async () => {
    process.env.TILEFORGE_ONNX_JSON_MAX_BODY_BYTES = "1024";
    const { POST } = await import("@/app/api/import/onnx/route");
    const body = JSON.stringify({ shapes: "x".repeat(2048) });
    const res = await POST(new Request("http://tileforge.local/api/import/onnx", {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) },
    }) as any);
    expect(res.status).toBe(413);
  });
});
