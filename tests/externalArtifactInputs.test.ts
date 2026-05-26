import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureArtifactInputs, missingArtifactInputs } from "../scripts/external-utils";

const roots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tileforge-artifacts-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("external artifact input guard", () => {
  it("does not overwrite existing job artifacts", async () => {
    const root = await tempRoot();
    const mlir = path.join(root, "generated.mlir");
    await writeFile(mlir, "sentinel", "utf8");
    const result = await ensureArtifactInputs(root, ["generated.mlir"], { allowDemoIfMissing: true });
    expect(result.createdDemo).toBe(false);
    expect(await readFile(mlir, "utf8")).toBe("sentinel");
  });

  it("can fail instead of silently generating a demo when no-demo is requested", async () => {
    const root = await tempRoot();
    expect(await missingArtifactInputs(root, ["generated.mlir"])).toEqual(["generated.mlir"]);
    await expect(ensureArtifactInputs(root, ["generated.mlir"], { allowDemoIfMissing: false })).rejects.toThrow(/missing/);
  });
});
