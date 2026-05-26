import { describe, expect, it } from "vitest";
import { absolutizeConfiguredToolCommand, scaleSimCommandCandidates } from "@/server/externalToolCandidates";

const root = "/repo-root";

describe("external tool command candidates", () => {
  it("absolutizes relative script operands while keeping wrapper commands intact", () => {
    expect(absolutizeConfiguredToolCommand("npx tsx scripts/mock-scalesim.ts", root)).toBe(
      "npx tsx /repo-root/scripts/mock-scalesim.ts",
    );
    expect(absolutizeConfiguredToolCommand("py -3 external/SCALE-Sim/scalesim/scale.py", root)).toBe(
      "py -3 /repo-root/external/SCALE-Sim/scalesim/scale.py",
    );
  });

  it("uses configured SCALE-Sim command as an absolute cwd-safe candidate", () => {
    const [candidate] = scaleSimCommandCandidates("npx tsx scripts/mock-scalesim.ts");
    expect(candidate).toContain("npx tsx");
    expect(candidate).toContain("/scripts/mock-scalesim.ts");
    expect(candidate).not.toContain(" scripts/mock-scalesim.ts");
  });
});
