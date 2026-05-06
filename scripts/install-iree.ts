import { spawnSync } from "node:child_process";
import { findPythonCommand, pipArgs } from "./python-utils";

const packages = ["iree-base-compiler", "iree-base-runtime"];
const upgrade = process.argv.includes("--upgrade") || process.argv.includes("--force");

function run(command: string, args: string[]): void {
  const printable = [command, ...args].join(" ");
  console.log(`$ ${printable}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const python = findPythonCommand();
console.log(`Using Python: ${python.label}`);

run(python.command, pipArgs(python, ["install", "--upgrade", "pip"]));
run(python.command, pipArgs(python, ["install", ...(upgrade ? ["--upgrade"] : []), ...packages]));

console.log("IREE compiler/runtime 설치가 완료되었습니다.");
console.log(`검증 명령: TILEFORGE_IREE_COMPILE_CMD="${python.label} -m iree.compiler.tools.scripts.iree_compile" npm run doctor:external -- --require-external`);
