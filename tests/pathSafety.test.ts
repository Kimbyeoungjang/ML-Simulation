import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveInsideRoot } from "@/server/pathSafety";

describe("resolveInsideRoot", () => {
  it("allows files inside the root", () => {
    const root = path.resolve("/tmp/tileforge-job");
    expect(resolveInsideRoot(root, "dataset/input.csv")).toBe(
      path.join(root, "dataset/input.csv"),
    );
  });

  it("rejects parent traversal outside the root", () => {
    const root = path.resolve("/tmp/tileforge-job");
    expect(resolveInsideRoot(root, "../secret.csv")).toBeUndefined();
  });

  it("does not accept sibling paths that merely share the same prefix", () => {
    const root = path.resolve("/tmp/job");
    expect(resolveInsideRoot(root, "../job-evil/data.csv")).toBeUndefined();
  });
});
