import { describe, expect, it } from "vitest";
import { migrateProjectArtifact, migrateResultArtifact } from "@/lib/artifactMigration";

describe("artifact migration", () => {
  it("adds schemaVersion to legacy result artifacts", () => {
    const out = migrateResultArtifact({ response: { summary: { totalCycles: 1 } } });
    expect(out.migrated).toBe(true);
    expect(out.artifact.schemaVersion).toBe("tileforge.result.v1");
  });

  it("keeps v1 result artifacts unchanged", () => {
    const input = { schemaVersion: "tileforge.result.v1", response: {} };
    const out = migrateResultArtifact(input);
    expect(out.migrated).toBe(false);
    expect(out.artifact).toBe(input);
  });

  it("wraps legacy project files", () => {
    const out = migrateProjectArtifact({ name: "legacy" });
    expect(out.schemaVersion).toBe("tileforge.project.v1");
    expect(out.artifact.name).toBe("legacy");
  });
});
