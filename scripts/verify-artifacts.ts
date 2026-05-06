import { readFile } from "node:fs/promises";
import path from "node:path";
import { verifyArtifactIntegrity, type ArtifactIntegrity } from "../src/server/artifactIntegrity";
import { jobDir } from "../src/server/workspace";

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error("Usage: npm run verify:artifacts -- <job-id>");
    process.exit(2);
  }
  const manifestPath = path.join(jobDir(jobId), "artifact_integrity.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const failures: string[] = [];
  for (const item of manifest.artifacts as ArtifactIntegrity[]) {
    const result = await verifyArtifactIntegrity(item);
    if (!result.ok) failures.push(`${item.name}: ${result.reason}`);
  }
  if (failures.length) {
    console.error(`Artifact integrity failed for ${jobId}:\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log(`Artifact integrity OK for ${jobId}: ${manifest.artifacts.length} artifacts`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
