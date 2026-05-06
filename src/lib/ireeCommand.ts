import type { HardwareConfig } from "@/types/domain";
export type IreeBackend = "llvm-cpu" | "vulkan" | "cuda" | "rocm" | "vmvx";
export function generateIreeCommand(backend: IreeBackend, input="generated.mlir", transform="transform.mlir", output="model.vmfb", hw?: HardwareConfig): string {
  const args = [
    "iree-compile",
    input,
    `--iree-hal-target-backends=${backend}`,
    "--iree-global-opt-enable-warn-on-uninitialized-values=false",
    `--iree-codegen-transform-dialect-library=${transform}`,
    `-o ${output}`,
  ];
  if (backend === "llvm-cpu") args.splice(3, 0, "--iree-llvmcpu-target-cpu=host");
  if (backend === "cuda") args.splice(3, 0, "--iree-hal-cuda-llvm-target-arch=sm_80");
  if (backend === "vulkan") args.splice(3, 0, "--iree-vulkan-target-triple=rdna3-unknown-linux");
  if (hw) args.push(`# TileForge hardware preset: ${hw.name} ${hw.arrayRows}x${hw.arrayCols} ${hw.dataflow}`);
  return args.join(" \\\n  ");
}
