import { describe, expect, it } from "vitest";
import { scaleSimArgs } from "@/server/externalToolCandidates";

describe("external tool command construction", () => {
  it("does not pass SCALE-Sim layout CSV by default", () => {
    const old = process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
    delete process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
    try {
      expect(scaleSimArgs("cfg", "topology", "layout", "out")).toEqual(["-c", "cfg", "-t", "topology", "-p", "out"]);
    } finally {
      if (old === undefined) delete process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
      else process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT = old;
    }
  });

  it("passes layout CSV only when explicitly enabled", () => {
    const old = process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
    process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT = "1";
    try {
      expect(scaleSimArgs("cfg", "topology", "layout", "out")).toEqual(["-c", "cfg", "-t", "topology", "-l", "layout", "-p", "out"]);
    } finally {
      if (old === undefined) delete process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
      else process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT = old;
    }
  });
});
