import { spawnSync } from "node:child_process";
const env = {
  ...process.env,
  TILEFORGE_SCALE_SIM_CMD: process.env.TILEFORGE_SCALE_SIM_CMD ?? "npx tsx scripts/mock-scalesim.ts",
  TILEFORGE_IREE_COMPILE_CMD: process.env.TILEFORGE_IREE_COMPILE_CMD ?? "npx tsx scripts/mock-iree-compile.ts",
  TILEFORGE_DETERMINISTIC: process.env.TILEFORGE_DETERMINISTIC ?? "1"
};
const r = spawnSync("npx", ["vitest", "run", "tests/integration.test.ts"], { stdio: "inherit", shell: process.platform === "win32", env });
process.exit(r.status ?? 1);
