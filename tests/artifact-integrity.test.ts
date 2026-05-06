import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256File, verifyArtifactIntegrity } from "../src/server/artifactIntegrity";

describe("artifact integrity", () => {
  it("detects matching and mismatching checksums", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tileforge-integrity-"));
    const file = path.join(dir, "report.md");
    await writeFile(file, "hello", "utf8");
    const sha256 = await sha256File(file);
    expect((await verifyArtifactIntegrity({ name: "report.md", path: file, sizeBytes: 5, sha256 })).ok).toBe(true);
    await writeFile(file, "changed", "utf8");
    expect((await verifyArtifactIntegrity({ name: "report.md", path: file, sizeBytes: 5, sha256 })).ok).toBe(false);
  });
});
