import type { MatmulShape } from "@/types/domain";
export interface FusionOpportunity { opName: string; pattern: string; estimatedBytesSaved: number; note: string; }
export function analyzeFusion(shapes: MatmulShape[]): FusionOpportunity[] {
  return shapes.flatMap(s => {
    const name = s.opName.toLowerCase(); const outBytes = s.m*s.n*s.dtypeBytes;
    const ops: FusionOpportunity[] = [];
    if (/(proj|linear|gemm|matmul|ffn|qkv)/.test(name)) ops.push({ opName: `${s.model}.${s.opName}`, pattern: "matmul + bias/activation", estimatedBytesSaved: outBytes, note: "epilogue를 fusion하면 출력 tensor를 다시 읽고 쓰는 DRAM traffic을 줄일 수 있습니다." });
    if (/conv/.test(name)) ops.push({ opName: `${s.model}.${s.opName}`, pattern: "conv + bias + activation", estimatedBytesSaved: outBytes, note: "Conv epilogue fusion은 DRAM traffic 감소에 도움이 됩니다." });
    if (/gelu|relu|act/.test(name)) ops.push({ opName: `${s.model}.${s.opName}`, pattern: "activation chain", estimatedBytesSaved: outBytes/2, note: "layout이 허용하면 producer 연산과 fusion하는 것을 검토하세요." });
    return ops;
  });
}
export function fusionMarkdown(ops: FusionOpportunity[]): string {
  if (!ops.length) return "# 9. Fusion 기회\n\n뚜렷한 fusion 기회가 감지되지 않았습니다.";
  return `# 9. Fusion 기회\n\n| 연산 | 패턴 | 절감 예상 byte | 설명 |\n|---|---|---:|---|\n` + ops.map(o=>`| ${o.opName} | ${o.pattern} | ${Math.round(o.estimatedBytesSaved).toLocaleString()} | ${o.note} |`).join("\n");
}
