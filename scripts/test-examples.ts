import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ProjectFileSchema } from "@/lib/validation";

async function main(): Promise<void> {
  const dir = path.join(process.cwd(), "examples", "projects");
  let count = 0;

  for (const name of await readdir(dir)) {
    if (!name.endsWith(".json")) continue;
    const json = JSON.parse(await readFile(path.join(dir, name), "utf8"));
    ProjectFileSchema.parse(json);
    count++;
  }

  console.log(`Validated ${count} example project(s).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
