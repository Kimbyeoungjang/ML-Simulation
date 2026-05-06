export type AnyArtifact = Record<string, any>;

export type MigrationResult = {
  schemaVersion: string;
  migrated: boolean;
  artifact: AnyArtifact;
  warnings: string[];
};

export function migrateResultArtifact(input: AnyArtifact): MigrationResult {
  const version = input?.schemaVersion ?? input?.version ?? "unknown";
  if (version === "tileforge.result.v1") return { schemaVersion: version, migrated: false, artifact: input, warnings: [] };
  if (version === "unknown" && input?.response) {
    return { schemaVersion: "tileforge.result.v1", migrated: true, artifact: { schemaVersion: "tileforge.result.v1", createdAt: input.createdAt, response: input.response }, warnings: ["Added missing result schemaVersion"] };
  }
  if (version === "tileforge.result.v0") {
    return { schemaVersion: "tileforge.result.v1", migrated: true, artifact: { schemaVersion: "tileforge.result.v1", createdAt: input.createdAt, response: input.payload ?? input.response }, warnings: ["Migrated tileforge.result.v0 to v1 view"] };
  }
  return { schemaVersion: String(version), migrated: false, artifact: input, warnings: [`No migration registered for ${version}`] };
}

export function migrateProjectArtifact(input: AnyArtifact): MigrationResult {
  const version = input?.schemaVersion ?? "unknown";
  if (version === "tileforge.project.v1") return { schemaVersion: version, migrated: false, artifact: input, warnings: [] };
  return { schemaVersion: "tileforge.project.v1", migrated: true, artifact: { schemaVersion: "tileforge.project.v1", ...input }, warnings: ["Wrapped project as tileforge.project.v1"] };
}
