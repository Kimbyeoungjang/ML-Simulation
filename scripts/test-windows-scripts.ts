import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = pkg.scripts ?? {};
const failures: string[] = [];

for (const key of ["validate:external:mock"]) {
  const script = String(scripts[key] ?? "");
  if (!script) failures.push(`${key} should exist`);
  else if (!script.includes("cross-env")) failures.push(`${key} should use cross-env for Windows-safe env vars`);
}
if (!pkg.engines?.node) failures.push("package.json should declare engines.node");
if (!pkg.packageManager) failures.push("package.json should declare packageManager");

const serverFiles = ["src/server/doctor.ts", "src/server/workerRunner.ts", "scripts/external-utils.ts"];
for (const file of serverFiles) {
  const text = readFileSync(file, "utf8");
  if (/python3 external\/SCALE-Sim/.test(text)) failures.push(`${file} should not hard-code python3 external/SCALE-Sim candidates`);
  if (/python3 -m scalesim\.scale/.test(text)) failures.push(`${file} should not hard-code python3 module candidates`);
}
const candidateText = readFileSync("src/server/externalToolCandidates.ts", "utf8");
if (!candidateText.includes("pythonCommandCandidates")) failures.push("externalToolCandidates should use shared Python candidate discovery");
if (!candidateText.includes("withPrependedPythonPath")) failures.push("externalToolCandidates should expose PYTHONPATH helper for SCALE-Sim source checkout");

if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("Windows-safe script checks passed.");
