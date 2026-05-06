import { runDoctor } from "../src/server/doctor";

async function main(): Promise<void> {
  const report = await runDoctor();
  for (const c of report.checks) console.log(`${c.ok ? "✓" : "!"} ${c.name}: ${c.detail}`);
  process.exit(report.ok ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
