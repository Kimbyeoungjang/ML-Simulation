import { estimateAll } from "@/lib/estimator";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
const response = estimateAll({ hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" });
if (!response.results.length) throw new Error("no results");
if (!response.artifacts.reportMarkdown.includes("TileForge")) throw new Error("report missing TileForge title");
console.log(`smoke ok: ${response.results.length} ops, totalCycles=${response.summary.totalCycles}`);
