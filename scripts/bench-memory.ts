import { estimateAll } from "../src/lib/estimator";
import { defaultCandidates, defaultHardware, defaultShapes } from "../src/lib/defaults";
import type { SearchRequest } from "../src/types/domain";

const iterations = Number(process.argv.find(a=>a.startsWith("--iterations="))?.split("=")[1] ?? 100);
const req: SearchRequest = { hardware: defaultHardware, shapes: Array.from({ length: 100 }, (_, i) => ({ ...defaultShapes[i % defaultShapes.length], id: `mem_${i}`, opName: `mem_${i}` })), candidates: defaultCandidates, objective: "balanced" };
const start = process.memoryUsage().heapUsed;
for (let i = 0; i < iterations; i++) estimateAll(req);
if (global.gc) global.gc();
const end = process.memoryUsage().heapUsed;
const growthMB = (end - start) / 1024 / 1024;
console.log(JSON.stringify({ iterations, startMB: +(start/1024/1024).toFixed(2), endMB: +(end/1024/1024).toFixed(2), growthMB: +growthMB.toFixed(2) }, null, 2));
