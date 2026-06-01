import { rm } from "node:fs/promises";
import { cleanGeneratedTargets } from "./generated-paths";

async function removePath(p: string): Promise<void> {
  try {
    await rm(p, { recursive: true, force: true });
    console.log(`removed ${p}`);
  } catch (error) {
    console.warn(`could not remove ${p}:`, error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  await Promise.all(cleanGeneratedTargets.map(removePath));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
