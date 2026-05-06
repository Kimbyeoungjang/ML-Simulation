import { describe, expect, it } from "vitest";
import { stampArtifact } from "@/lib/schemas";

describe("deterministic mode", () => {
  it("stamps stable timestamps when requested", async () => {
    process.env.TILEFORGE_DETERMINISTIC = "1";
    const a = stampArtifact("x", { value: 1 });
    const b = stampArtifact("x", { value: 2 });
    expect(a.createdAt).toBe("2000-01-01T00:00:00.000Z");
    expect(b.createdAt).toBe(a.createdAt);
    process.env.TILEFORGE_DETERMINISTIC = "";
  });
});
