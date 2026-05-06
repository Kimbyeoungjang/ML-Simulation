import { writeFile } from "node:fs/promises";
import path from "node:path";

function opt(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

async function main(): Promise<void> {
  if (process.argv.includes("--version")) {
    console.log("mock iree-compile 0.0.0");
    return;
  }
  const firstInput = process.argv.slice(2).find(arg => !arg.startsWith("-")) ?? "generated.mlir";
  const out = process.env.TILEFORGE_MOCK_VMFB ?? opt("-o", path.join(path.dirname(path.resolve(firstInput)), "model.vmfb")) ?? path.join(path.dirname(path.resolve(firstInput)), "model.vmfb");
  await writeFile(out, "MOCK_VMFB\n", "utf8");
  console.log(`mock iree-compile accepted ${firstInput}`);
  console.log(`생성 완료: ${out}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
