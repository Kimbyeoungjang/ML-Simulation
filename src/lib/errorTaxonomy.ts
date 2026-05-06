export type TileForgeErrorCode =
  | "VALIDATION_ERROR"
  | "TOOL_NOT_CONFIGURED"
  | "TOOL_TIMEOUT"
  | "TOOL_EXIT_NONZERO"
  | "ARTIFACT_INTEGRITY_FAILED"
  | "DB_MIGRATION_FAILED"
  | "CACHE_CORRUPT"
  | "BUNDLE_TOO_LARGE"
  | "JOB_QUOTA_EXCEEDED"
  | "JOB_CANCELLED"
  | "INTERNAL_INVARIANT_FAILED"
  | "UNKNOWN_ERROR";

export interface StructuredError {
  code: TileForgeErrorCode;
  stage?: string;
  recoverable: boolean;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

const HINTS: Record<TileForgeErrorCode, string> = {
  VALIDATION_ERROR: "Fix the highlighted input fields and run validation again.",
  TOOL_NOT_CONFIGURED: "Configure the corresponding TILEFORGE_*_CMD environment variable or use the mock integration profile.",
  TOOL_TIMEOUT: "Increase TILEFORGE_TOOL_TIMEOUT_MS or reduce workload size.",
  TOOL_EXIT_NONZERO: "Open the job logs and inspect the external tool stderr output.",
  ARTIFACT_INTEGRITY_FAILED: "Regenerate the job artifacts before downloading the experiment bundle.",
  DB_MIGRATION_FAILED: "Back up .tileforge/tileforge.db and inspect migration logs.",
  CACHE_CORRUPT: "Run npm run cache:clean or set TILEFORGE_DISABLE_CACHE=1.",
  BUNDLE_TOO_LARGE: "Lower TILEFORGE_MAX_BUNDLE_MB, clean artifacts, or download individual files.",
  JOB_QUOTA_EXCEEDED: "Clean old jobs or wait for running jobs to finish.",
  JOB_CANCELLED: "The job was cancelled by the user.",
  INTERNAL_INVARIANT_FAILED: "Open a bug with the request JSON, result.json, and events.ndjson.",
  UNKNOWN_ERROR: "Inspect logs.txt and events.ndjson for more details."
};

export function makeStructuredError(input: Partial<StructuredError> & { message: string }): StructuredError {
  const code = input.code ?? "UNKNOWN_ERROR";
  return {
    code,
    stage: input.stage,
    recoverable: input.recoverable ?? code !== "INTERNAL_INVARIANT_FAILED",
    message: input.message,
    hint: input.hint ?? HINTS[code],
    details: input.details
  };
}

export function serializeError(err: unknown, stage?: string): StructuredError {
  if (typeof err === "object" && err && "code" in err && "message" in err) return err as StructuredError;
  if (err instanceof Error) {
    const code: TileForgeErrorCode = err.name === "AbortError" ? "TOOL_TIMEOUT" : "UNKNOWN_ERROR";
    return makeStructuredError({ code, stage, message: err.message, details: { name: err.name, stack: err.stack } });
  }
  return makeStructuredError({ code: "UNKNOWN_ERROR", stage, message: String(err) });
}
