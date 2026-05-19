import { describe, expect, it } from "vitest";
import { createZip, normalizeZipPath } from "@/lib/zip";

describe("zip archive writer", () => {
  it("normalizes unsafe or platform-specific paths", () => {
    expect(normalizeZipPath("../a/./b.txt")).toBe("a/b.txt");
    expect(normalizeZipPath("C:\\tmp\\tile\\out.txt")).toBe("tmp/tile/out.txt");
    expect(normalizeZipPath("/absolute/path.txt")).toBe("absolute/path.txt");
  });

  it("creates deterministic archives regardless of input object order", () => {
    const a = createZip({ "b.txt": "B", "a.txt": "A" });
    const b = createZip({ "a.txt": "A", "b.txt": "B" });
    expect(a.equals(b)).toBe(true);
  });

  it("rejects duplicate names after path normalization", () => {
    expect(() => createZip({ "safe/file.txt": "A", "../safe/file.txt": "B" })).toThrow(/duplicate zip entry/);
  });
});
