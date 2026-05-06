import type { Conv2DShape, MatmulShape } from "@/types/domain";
export function conv2dOutputSize(input: number, kernel: number, stride: number, pad: number, dilation: number): number {
  const effective = dilation * (kernel - 1) + 1;
  return Math.floor((input + 2 * pad - effective) / stride) + 1;
}
export function conv2dToGemm(conv: Conv2DShape): MatmulShape {
  const outH = conv2dOutputSize(conv.inputH, conv.kernelH, conv.strideH, conv.padH, conv.dilationH);
  const outW = conv2dOutputSize(conv.inputW, conv.kernelW, conv.strideW, conv.padW, conv.dilationW);
  if (outH <= 0 || outW <= 0) throw new Error("Invalid Conv2D geometry: output dimension is not positive.");
  return { id: `${conv.id}_gemm`, model: conv.model, opName: `${conv.opName}_im2col_gemm`, m: conv.batch * outH * outW, n: conv.outputC, k: conv.kernelH * conv.kernelW * conv.inputC, dtypeBytes: conv.dtypeBytes, source: "conv" };
}
