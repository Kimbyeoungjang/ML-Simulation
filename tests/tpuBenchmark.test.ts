import { describe, expect, it } from "vitest";
import { defaultHardware, defaultShapes } from "@/lib/defaults";
import {
  buildTpuBenchmarkRows,
  compareTpuMeasurements,
  compareTpuSamples,
  parseTpuBenchmarkExportCsv,
  parseTpuMeasurementCsv,
  parseTpuSampleCsv,
  tpuBenchmarkRowsToCsv,
  tpuCalibrationCsv,
  tpuSampleComparisonRowsToCsv,
  summarizeTpuRecommendation,
} from "@/lib/tpuBenchmark";

const candidates = { tileM: [64, 128], tileN: [64, 128], tileK: [64, 128] };

describe("TPU benchmark export/import", () => {
  it("exports TileForge predictions as TPU benchmark CSV", () => {
    const rows = buildTpuBenchmarkRows({
      hardware: defaultHardware,
      shapes: [defaultShapes[0]],
      candidates,
      objective: "hardware-design",
      maxResultsPerOp: 4,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].predictedCycles).toBeGreaterThan(0);
    expect(rows[0].predictedTimeUs).toBeCloseTo(rows[0].predictedCycles / defaultHardware.frequencyMHz);

    const parsed = parseTpuBenchmarkExportCsv(tpuBenchmarkRowsToCsv(rows));
    expect(parsed[0].id).toBe(defaultShapes[0].id);
    expect(parsed[0].m).toBe(defaultShapes[0].m);
  });

  it("merges TPU runtime CSV into comparison and calibration rows", () => {
    const predicted = parseTpuBenchmarkExportCsv(`id,model,op_name,m,n,k,dtype_bytes,dtype,hardware_name,array,dataflow,frequency_mhz,predicted_cycles,predicted_time_us,prediction_confidence,best_tile_m,best_tile_n,best_tile_k,full_layer_compute_cycles,full_layer_stall_cycles,tile_policy_cycles\nvit_attn_qkv,vit-s,attention_qkv,197,2304,384,2,bf16,TPUv2-like,128x128,WS,700,1000,1.428571,1,128,128,128,900,100,200\n`);
    const measurements = parseTpuMeasurementCsv(`id,model,op_name,m,n,k,dtype,median_us,mean_us,p90_us,achieved_tflops,reps\nvit_attn_qkv,vit-s,attention_qkv,197,2304,384,bf16,2,2.2,2.5,100,50\n`);
    const rows = compareTpuMeasurements(predicted, measurements);
    expect(rows).toHaveLength(1);
    expect(rows[0].measuredCycles).toBe(1400);
    expect(rows[0].runtimeRatio).toBeCloseTo(1.4);

    const calibration = tpuCalibrationCsv(rows);
    expect(calibration).toContain("predicted_cycles,measured_cycles");
    expect(calibration).toContain("1000,1400");
  });
  it("merges raw TPU timing samples for distribution graphs", () => {
    const predicted = parseTpuBenchmarkExportCsv(`id,model,op_name,m,n,k,dtype_bytes,dtype,hardware_name,array,dataflow,frequency_mhz,predicted_cycles,predicted_time_us,prediction_confidence,best_tile_m,best_tile_n,best_tile_k,full_layer_compute_cycles,full_layer_stall_cycles,tile_policy_cycles\nvit_attn_qkv,vit-s,attention_qkv,197,2304,384,2,bf16,TPUv2-like,128x128,WS,700,1000,1.428571,1,128,128,128,900,100,200\n`);
    const samples = parseTpuSampleCsv(`id,model,op_name,m,n,k,dtype,rep,measured_us\nvit_attn_qkv,vit-s,attention_qkv,197,2304,384,bf16,0,1.5\nvit_attn_qkv,vit-s,attention_qkv,197,2304,384,bf16,1,2.0\n`);
    const rows = compareTpuSamples(predicted, samples);
    expect(rows).toHaveLength(2);
    expect(rows[0].measuredCycles).toBe(1050);
    expect(rows[1].runtimeRatio).toBeCloseTo(1.4);
    expect(tpuSampleComparisonRowsToCsv(rows)).toContain("measuredUs,predictedTimeUs");
  });

  it("summarizes whether TileForge predicted winner is also strong on TPU", () => {
    const predicted = parseTpuBenchmarkExportCsv(`id,model,op_name,m,n,k,dtype_bytes,dtype,hardware_name,array,dataflow,frequency_mhz,predicted_cycles,predicted_time_us,prediction_confidence,best_tile_m,best_tile_n,best_tile_k,full_layer_compute_cycles,full_layer_stall_cycles,tile_policy_cycles
a,quick,a,512,512,512,2,bf16,TPUv2-like,128x128,WS,700,1000,1.428571,1,128,128,128,900,100,200
b,quick,b,1024,1024,1024,2,bf16,TPUv2-like,128x128,WS,700,4000,5.714286,1,128,128,128,3600,400,800
c,quick,c,256,256,2048,2,bf16,TPUv2-like,128x128,WS,700,1200,1.714286,1,128,128,128,1000,200,300
`);
    const measurements = parseTpuMeasurementCsv(`id,model,op_name,m,n,k,dtype,median_us,mean_us,p90_us,achieved_tflops,reps
a,quick,a,512,512,512,bf16,2.0,2.0,2.1,134,30
b,quick,b,1024,1024,1024,bf16,8.0,8.0,8.2,268,30
c,quick,c,256,256,2048,bf16,2.2,2.2,2.4,122,30
`);
    const rows = compareTpuMeasurements(predicted, measurements);
    const summary = summarizeTpuRecommendation(rows);
    expect(summary?.mode).toBe("throughput");
    expect(summary?.candidateCount).toBe(3);
    expect(summary?.predictedBestMeasuredRank).toBeLessThanOrEqual(3);
    expect(summary?.rows[0].measuredRank).toBe(1);
  });

});
