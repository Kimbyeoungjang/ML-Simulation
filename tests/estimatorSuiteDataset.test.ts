import { describe, expect, it } from "vitest";
import { buildEstimatorDataset, estimatorDatasetSummaryMarkdown } from "../src/lib/estimatorSuiteDataset";

const header = "id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles";
function row(id: string, dataflow: string, estimated: number, measured: number) {
  return `${id},vit,qkv,128,128,8192,700,${dataflow},2,197,2304,384,128,256,128,${estimated},${measured}`;
}

describe("estimator suite dataset manager", () => {
  it("merges uploaded csv files and removes duplicates", () => {
    const csvA = [header, row("a", "WS", 1000, 1100), row("b", "OS", 1200, 1300)].join("\n");
    const csvB = [header, row("b", "OS", 1200, 1300), row("c", "IS", 1400, 1600)].join("\n");
    const dataset = buildEstimatorDataset([
      { name: "a.csv", text: csvA },
      { name: "b.csv", text: csvB },
    ]);
    expect(dataset.summary.files).toBe(2);
    expect(dataset.summary.inputRows).toBe(4);
    expect(dataset.summary.mergedRows).toBe(3);
    expect(dataset.summary.duplicatesRemoved).toBe(1);
    expect(dataset.summary.validSamples).toBe(3);
    expect(dataset.summary.dataflows).toEqual({ WS: 1, OS: 1, IS: 1 });
    expect(dataset.csv).toContain("sourceCsv");
  });

  it("reports invalid measured cycle rows", () => {
    const csv = [header, row("a", "WS", 1000, 1100), row("bad", "WS", 1200, 0)].join("\n");
    const dataset = buildEstimatorDataset([{ name: "bad.csv", text: csv }]);
    expect(dataset.summary.validSamples).toBe(1);
    expect(dataset.summary.missingMeasuredCycles).toBe(1);
    const md = estimatorDatasetSummaryMarkdown(dataset.summary);
    expect(md).toContain("Estimator Suite Dataset Summary");
    expect(md).toContain("measuredCycles");
  });
});
