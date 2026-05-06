import { describe, expect, it } from "vitest";
import { makeStructuredError, serializeError } from "../src/lib/errorTaxonomy";

describe("structured errors", () => {
  it("fills default hints", () => {
    const err = makeStructuredError({ code: "TOOL_TIMEOUT", message: "timeout", recoverable: true });
    expect(err.hint).toContain("TILEFORGE_TOOL_TIMEOUT_MS");
  });
  it("serializes Error instances", () => {
    const err = serializeError(new Error("boom"), "estimate");
    expect(err.stage).toBe("estimate");
    expect(err.message).toContain("boom");
  });
});
