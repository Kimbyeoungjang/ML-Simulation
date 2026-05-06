export type TileForgeErrorCode =
  | "VALIDATION_ERROR" | "EXTERNAL_TOOL_NOT_CONFIGURED" | "EXTERNAL_TOOL_FAILED" | "TIMEOUT"
  | "ARTIFACT_WRITE_ERROR" | "MODEL_IMPORT_ERROR" | "NUMERICAL_ERROR" | "INTERNAL_INVARIANT_ERROR" | "CANCELLED";

export class TileForgeError extends Error {
  constructor(
    public readonly code: TileForgeErrorCode,
    message: string,
    public readonly options: { stage?: string; hint?: string; recoverable?: boolean; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "TileForgeError";
  }
  toJSON() { return { code: this.code, message: this.message, ...this.options, cause: undefined }; }
}

export function normalizeError(error: unknown, fallbackCode: TileForgeErrorCode = "INTERNAL_INVARIANT_ERROR") {
  if (error instanceof TileForgeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new TileForgeError(fallbackCode, message, { cause: error });
}
