import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "doctor"]],
  ["npm", ["run", "check:clean"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "test:unit"]],
  ["npm", ["run", "test:advanced"]],
  ["npm", ["run", "test:docs"]],
  ["npm", ["run", "test:examples"]],
  ["npm", ["run", "test:windows-scripts"]],
  ["npm", ["run", "validate:reference"]],
  ["npm", ["run", "bench:suite"]],
  ["npm", ["run", "bench:threadpool"]],
  ["npm", ["run", "profile:estimator"]],
  ["npm", ["run", "build"]],
] as const;

for (const [cmd, args] of commands) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
console.log("Release check passed.");
