import { nowIso } from "./determinism";

export const RESULT_SCHEMA_VERSION = "tileforge.result.v1";
export const MANIFEST_SCHEMA_VERSION = "tileforge.manifest.v1";
export const PROJECT_SCHEMA_VERSION = "tileforge.project.v1";
export const POLICY_DB_SCHEMA_VERSION = "tileforge.policy-db.v1";

export function stampArtifact<T extends object>(schemaVersion: string, payload: T) {
  return {
    schemaVersion,
    toolVersion: "0.9.0",
    createdAt: nowIso(),
    ...payload
  };
}
