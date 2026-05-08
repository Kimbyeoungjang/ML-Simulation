import { describe, expect, it } from "vitest";
import { scaleSimArgs } from "@/server/externalToolCandidates";

describe("external tool command construction", () => {
  it("passes SCALE-Sim layout CSV by default when a layout path is provided", () => {
    const oldLayout = process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
    const oldOutput = process.env.TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG;
    delete process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
    delete process.env.TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG;
    try {
      expect(scaleSimArgs({ config: "cfg", topology: "topology", layout: "layout", outDir: "out" })).toEqual(["-c", "cfg", "-t", "topology", "-l", "layout"]);
    } finally {
      if (oldLayout === undefined) delete process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
      else process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT = oldLayout;
      if (oldOutput === undefined) delete process.env.TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG;
      else process.env.TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG = oldOutput;
    }
  });

  it("omits layout when disabled and adds output arg only when requested", () => {
    const oldLayout = process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
    const oldOutput = process.env.TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG;
    process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT = "0";
    process.env.TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG = "1";
    try {
      expect(scaleSimArgs({ config: "cfg", topology: "topology", layout: "layout", outDir: "out" })).toEqual(["-c", "cfg", "-t", "topology", "-p", "out"]);
    } finally {
      if (oldLayout === undefined) delete process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT;
      else process.env.TILEFORGE_SCALE_SIM_USE_LAYOUT = oldLayout;
      if (oldOutput === undefined) delete process.env.TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG;
      else process.env.TILEFORGE_SCALE_SIM_USE_OUTPUT_ARG = oldOutput;
    }
  });
});
