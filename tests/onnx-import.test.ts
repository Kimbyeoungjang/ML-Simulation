import { describe, expect, it } from "vitest";
import { parseOnnxShapeJson, parseMlirMatmulShapes } from "../src/lib/onnx";
import { conv2dToGemm } from "../src/lib/conv";

describe("ONNX/MLIR import helpers", () => {
  it("parses shape summary JSON", () => {
    const shapes = parseOnnxShapeJson(JSON.stringify([{ model: "m", op_name: "q", m: 16, n: 32, k: 64 }]));
    expect(shapes[0]).toMatchObject({ model: "m", opName: "q", m: 16, n: 32, k: 64, source: "onnx" });
  });

  it("extracts static matmul shapes from MLIR text", () => {
    const shapes = parseMlirMatmulShapes("%0 = linalg.matmul ins(%a, %b : tensor<8x16xf32>, tensor<16x32xf32>) outs(%c : tensor<8x32xf32>)");
    expect(shapes[0]).toMatchObject({ m: 8, k: 16, n: 32, dtypeBytes: 4 });
  });

  it("converts Conv2D NCHW-like fields to GEMM", () => {
    const gemm = conv2dToGemm({ id: "c", model: "resnet", opName: "conv", batch: 1, inputH: 224, inputW: 224, inputC: 64, outputC: 128, kernelH: 3, kernelW: 3, strideH: 1, strideW: 1, padH: 1, padW: 1, dilationH: 1, dilationW: 1, dtypeBytes: 2 });
    expect(gemm.m).toBe(224 * 224);
    expect(gemm.n).toBe(128);
    expect(gemm.k).toBe(3 * 3 * 64);
  });
});
