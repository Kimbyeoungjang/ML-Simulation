import { spawnSync } from "node:child_process";
const commands = [
  ["npm", ["run", "doctor"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "test:property"]],
  ["npm", ["run", "test:metamorphic"]],
  ["npm", ["run", "test:contract"]],
  ["npm", ["run", "test:schema"]],
  ["npm", ["run", "test:integrity"]],
  ["npm", ["run", "test:reference"]],
  ["npm", ["run", "test:docs"]],
  ["npm", ["run", "test:sqlite-fallback"]],
  ["npm", ["run", "test:artifact-migration"]],
  ["npm", ["run", "test:examples"]],
  ["npm", ["run", "test:onnx"]],
  ["npm", ["run", "test:windows-scripts"]],
  ["npm", ["run", "smoke"]],
  ["npm", ["run", "validate:reference"]],
  ["npm", ["run", "bench:suite"]],
  ["npm", ["run", "bench:threadpool"]],
  ["npm", ["run", "profile:estimator"]],
  ["npm", ["run", "build"]]
] as const;
for (const [cmd, args] of commands) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("Release check passed.");
