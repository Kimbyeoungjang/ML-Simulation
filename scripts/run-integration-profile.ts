import { spawnSync } from "node:child_process";

const profile = process.argv[2] ?? "mock";
const env = { ...process.env };
if (profile === "mock") {
  env.TILEFORGE_SCALE_SIM_CMD = env.TILEFORGE_SCALE_SIM_CMD ?? "npx tsx scripts/mock-scalesim.ts";
  env.TILEFORGE_IREE_COMPILE_CMD = env.TILEFORGE_IREE_COMPILE_CMD ?? "npx tsx scripts/mock-iree-compile.ts";
} else if (profile === "iree") {
  if (!env.TILEFORGE_IREE_COMPILE_CMD) {
    console.log("Skipping real IREE integration: TILEFORGE_IREE_COMPILE_CMD is not set.");
    process.exit(0);
  }
} else if (profile === "scalesim") {
  if (!env.TILEFORGE_SCALE_SIM_CMD) {
    console.log("Skipping real SCALE-Sim integration: TILEFORGE_SCALE_SIM_CMD is not set.");
    process.exit(0);
  }
} else if (profile === "full") {
  if (!env.TILEFORGE_IREE_COMPILE_CMD || !env.TILEFORGE_SCALE_SIM_CMD) {
    console.log("Skipping full real integration: configure both TILEFORGE_IREE_COMPILE_CMD and TILEFORGE_SCALE_SIM_CMD.");
    process.exit(0);
  }
} else {
  console.error(`Unknown integration profile: ${profile}`);
  process.exit(2);
}
const result = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "tests/integration.test.ts"], { stdio: "inherit", env, shell: false });
process.exit(result.status ?? 1);
