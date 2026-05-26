import type { HardwareConfig } from "@/types/domain";
export type IreeBackend = "llvm-cpu" | "vulkan" | "cuda" | "rocm" | "vmvx";

function backendArgs(backend: IreeBackend): string[] {
  const args = [`--iree-hal-target-backends=${backend}`];
  if (backend === "llvm-cpu") args.push("--iree-llvmcpu-target-cpu=host");
  if (backend === "cuda") args.push("--iree-hal-cuda-llvm-target-arch=sm_80");
  if (backend === "vulkan") args.push("--iree-vulkan-target-triple=rdna3-unknown-linux");
  return args;
}

function shellCommand(parts: string[]) {
  return parts.join(" \\\n  ");
}

export function generateIreeCommand(
  backend: IreeBackend,
  input = "generated.mlir",
  transform = "transform.mlir",
  output = "model.vmfb",
  hw?: HardwareConfig,
): string {
  const common = [
    "iree-compile",
    input,
    ...backendArgs(backend),
    "--iree-global-opt-enable-warn-on-uninitialized-values=false",
    "-o",
    output,
  ];
  const experimental = [
    "iree-compile",
    input,
    ...backendArgs(backend),
    "--iree-global-opt-enable-warn-on-uninitialized-values=false",
    `--iree-codegen-transform-dialect-library=${transform}`,
    "-o",
    output,
  ];
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "# Safe baseline compile: checks IREE compileability without forcing TileForge transform hints.",
    shellCommand(common),
    "",
    "# Experimental lowering-hint compile. Enable only after your local IREE version accepts transform.mlir.",
    "# Compare runtime against the safe baseline before treating this as an optimization.",
    shellCommand(experimental.map((part, index) => index === 0 ? `# ${part}` : `# ${part}`)),
  ];
  if (hw) lines.push("", `# TileForge hardware preset: ${hw.name} ${hw.arrayRows}x${hw.arrayCols} ${hw.dataflow}`);
  return lines.join("\n");
}
