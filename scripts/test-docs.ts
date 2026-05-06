import { readFile } from "node:fs/promises";

async function main(): Promise<void> {
  const readme = await readFile("README.md", "utf8");
  const required = ["npm install", "npm run dev", "npm run doctor"];
  const missing = required.filter(x => !readme.includes(x));
  if (missing.length) {
    console.error(`README is missing documented command(s): ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("Documentation command smoke check passed.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
