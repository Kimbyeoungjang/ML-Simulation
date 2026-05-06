import type { MatmulShape } from "@/types/domain";
import { conv2dToGemm } from "./conv";

export interface OnnxImportReport { shapes: MatmulShape[]; warnings: string[]; nodesSeen: number; initializersSeen: number; }
type DimMap = Map<string, number[]>;

export function parseOnnxShapeJson(text: string): MatmulShape[] {
  const data = JSON.parse(text) as any[];
  if (!Array.isArray(data)) throw new Error("ONNX shape summary must be a JSON array.");
  return data.map((x, i) => ({ id: String(x.id ?? `onnx_${i}`), model: String(x.model ?? "onnx-model"), opName: String(x.opName ?? x.op_name ?? `op_${i}`), m: Number(x.m), n: Number(x.n), k: Number(x.k), dtypeBytes: Number(x.dtypeBytes ?? x.dtype_bytes ?? 2), source: "onnx" as const }));
}

export function parseMlirMatmulShapes(text: string): MatmulShape[] {
  const out: MatmulShape[] = [];
  const re = /tensor<(\d+)x(\d+)xf(16|32|64)>.*?tensor<(\d+)x(\d+)xf(16|32|64)>/gs;
  let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    const a0 = Number(m[1]), a1 = Number(m[2]), b0 = Number(m[4]), b1 = Number(m[5]);
    if (a1 === b0) out.push({ id: `mlir_${i}`, model: "mlir", opName: `matmul_${i++}`, m: a0, k: a1, n: b1, dtypeBytes: Number(m[3]) <= 16 ? 2 : 4, source: "mlir" });
  }
  return out;
}

function dimOfValueInfo(v: any): number[] | undefined {
  const dims = v?.type?.tensorType?.shape?.dim ?? v?.type?.tensor_type?.shape?.dim;
  if (!Array.isArray(dims)) return undefined;
  const out = dims.map((d: any) => Number(d.dimValue ?? d.dim_value ?? d.value ?? 0));
  return out.every((x: number) => Number.isFinite(x) && x > 0) ? out : undefined;
}
function dimOfInitializer(t: any): number[] | undefined {
  const dims = (t?.dims ?? []).map((x: any)=>Number(x));
  return dims.length && dims.every((x: number)=>Number.isFinite(x) && x > 0) ? dims : undefined;
}
function nameOf(v: any): string { return String(v?.name ?? ""); }
function opInput(node: any, i: number): string | undefined { return node?.input?.[i] ? String(node.input[i]) : undefined; }
function opName(node: any, i: number): string { return String(node?.name || `${node?.opType ?? node?.op_type ?? "op"}_${i}`); }
function opType(node: any): string { return String(node?.opType ?? node?.op_type ?? ""); }

export async function parseOnnxBuffer(buffer: ArrayBuffer, modelName = "onnx-model"): Promise<OnnxImportReport> {
  const warnings: string[] = [];
  let onnx: any;
  try { onnx = await import("onnx-proto"); }
  catch (e) { throw new Error("onnx-proto dependency is missing. Run npm install, or import an exported ONNX shape-summary JSON instead."); }
  const decoder = onnx.onnx?.ModelProto ?? onnx.ModelProto;
  if (!decoder?.decode) throw new Error("Unsupported onnx-proto package shape: ModelProto.decode not found.");
  const model = decoder.decode(new Uint8Array(buffer));
  const graph = model.graph;
  if (!graph) throw new Error("ONNX model has no graph.");
  const dims: DimMap = new Map();
  for (const v of [...(graph.input ?? []), ...(graph.valueInfo ?? graph.value_info ?? []), ...(graph.output ?? [])]) { const d = dimOfValueInfo(v); const n = nameOf(v); if (n && d) dims.set(n, d); }
  for (const t of graph.initializer ?? []) { const d = dimOfInitializer(t); const n = nameOf(t); if (n && d) dims.set(n, d); }
  const shapes: MatmulShape[] = [];
  const nodes = graph.node ?? [];
  for (let i=0; i<nodes.length; i++) {
    const node = nodes[i];
    const type = opType(node);
    if (type === "MatMul" || type === "Gemm") {
      const a = dims.get(opInput(node,0) ?? ""); const b = dims.get(opInput(node,1) ?? "");
      if (!a || !b || a.length < 2 || b.length < 2) { warnings.push(`Skipped ${opName(node,i)}: missing static rank-2+ input shapes.`); continue; }
      const attrs = Object.fromEntries((node.attribute ?? []).map((attr:any)=>[String(attr.name), attr]));
      const intAttr = (name: string, def = 0) => Number(attrs[name]?.i ?? attrs[name]?.intValue ?? attrs[name]?.int_value ?? def);
      const transA = type === "Gemm" && intAttr("transA") === 1;
      const transB = type === "Gemm" && intAttr("transB") === 1;
      const aRows = transA ? a[a.length-1] : a[a.length-2];
      const aCols = transA ? a[a.length-2] : a[a.length-1];
      const bRows = transB ? b[b.length-1] : b[b.length-2];
      const bCols = transB ? b[b.length-2] : b[b.length-1];
      const m = aRows, kA = aCols, kB = bRows, n = bCols;
      const k = kA || kB;
      if (kA && kB && kA !== kB) warnings.push(`${opName(node,i)}: K mismatch ${kA} vs ${kB}; using left-hand K. transA=${transA}, transB=${transB}`);
      shapes.push({ id: `onnx_${i}`, model: modelName, opName: opName(node,i), m, n, k, dtypeBytes: 2, source: "onnx" });
    } else if (type === "Conv") {
      const x = dims.get(opInput(node,0) ?? ""); const w = dims.get(opInput(node,1) ?? "");
      if (!x || !w || x.length < 4 || w.length < 4) { warnings.push(`Skipped ${opName(node,i)} Conv: missing NCHW input/weight shapes.`); continue; }
      const attrs = Object.fromEntries((node.attribute ?? []).map((a:any)=>[String(a.name), a]));
      const ints = (name:string, def:number[]) => (attrs[name]?.ints?.length ? attrs[name].ints.map((x:any)=>Number(x)) : def);
      const pads = ints("pads", [0,0,0,0]); const strides = ints("strides", [1,1]); const dilations = ints("dilations", [1,1]);
      try { shapes.push(conv2dToGemm({ id:`onnx_conv_${i}`, model:modelName, opName:opName(node,i), batch:x[0], inputH:x[2], inputW:x[3], inputC:x[1], outputC:w[0], kernelH:w[2], kernelW:w[3], strideH:strides[0], strideW:strides[1] ?? strides[0], padH:pads[0], padW:pads[1] ?? pads[0], dilationH:dilations[0], dilationW:dilations[1] ?? dilations[0], dtypeBytes:2 })); }
      catch(e:any) { warnings.push(`Skipped ${opName(node,i)} Conv: ${e.message}`); }
    }
  }
  return { shapes, warnings, nodesSeen: nodes.length, initializersSeen: (graph.initializer ?? []).length };
}
