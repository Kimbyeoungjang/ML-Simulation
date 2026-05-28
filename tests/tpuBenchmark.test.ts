import { describe, expect, it } from "vitest";
import { defaultHardware, defaultShapes } from "@/lib/defaults";
import {
  buildTpuBenchmarkRows,
  compareTpuMeasurements,
  parseTpuBenchmarkExportCsv,
  parseTpuMeasurementCsv,
  tpuBenchmarkRowsToCsv,
  tpuCalibrationCsv,
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
});
