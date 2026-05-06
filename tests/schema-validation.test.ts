import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { estimateAll } from "@/lib/estimator";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { RESULT_SCHEMA_VERSION, stampArtifact } from "@/lib/schemas";

describe("artifact JSON schemas", () => {
  it("validates generated result envelope", () => {
    const ajv = new Ajv2020({ allErrors: true });
    const schema = JSON.parse(readFileSync("schemas/result.schema.json", "utf8"));
    const validate = ajv.compile(schema);
    const result = stampArtifact(RESULT_SCHEMA_VERSION, { response: estimateAll({ hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" }) });
    expect(validate(result)).toBe(true);
  });
});
