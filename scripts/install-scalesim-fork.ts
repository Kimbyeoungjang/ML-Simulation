import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { findPythonCommand, pipArgs } from "./python-utils";

const repoUrl = process.env.TILEFORGE_SCALE_SIM_REPO ?? "https://github.com/Kimbyeoungjang/SCALE-Sim";
const target = path.resolve(process.env.TILEFORGE_SCALE_SIM_DIR ?? "external/SCALE-Sim");
const force = process.argv.includes("--force");

function run(command: string, args: string[]): void {
  const printable = [command, ...args].join(" ");
  console.log(`$ ${printable}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (force && existsSync(target)) {
  rmSync(target, { recursive: true, force: true });
}

if (!existsSync(target)) {
  run("git", ["clone", "--depth", "1", repoUrl, target]);
} else {
  console.log(`Using existing SCALE-Sim checkout: ${target}`);
}

const python = findPythonCommand();
console.log(`Using Python: ${python.label}`);

run(python.command, pipArgs(python, ["install", "--upgrade", "pip"]));
run(python.command, pipArgs(python, ["install", "-e", target]));
console.log("SCALE-Sim is installed from:", repoUrl);
console.log(`Try: TILEFORGE_SCALE_SIM_CMD="${python.label} -m scalesim.scale" npm run validate:external -- --require-external --timeout-ms 180000`);
