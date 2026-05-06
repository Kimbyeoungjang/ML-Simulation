import type { EnergySummary, HardwareConfig, MatmulShape, TileCandidateResult } from "@/types/domain";
function bytesMoved(shape: MatmulShape): number { const b = shape.dtypeBytes || 2; return (shape.m*shape.k + shape.k*shape.n + shape.m*shape.n) * b; }
export function computeEnergy(hw: HardwareConfig, pairs: Array<{ shape: MatmulShape; best: TileCandidateResult }>): EnergySummary {
  const eMac = hw.energyPerMacPJ ?? 1.0, eSram = hw.energyPerSramAccessPJ ?? 5.0, eDramByte = hw.energyPerDramBytePJ ?? 60.0, staticW = hw.staticPowerW ?? 0;
  const byOpRaw = pairs.map(({ shape, best }) => {
    const macs = shape.m * shape.n * shape.k;
    const bytes = bytesMoved(shape);
    const macUJ = macs * eMac / 1e6;
    const sramUJ = (best.sramBytes / Math.max(1, shape.dtypeBytes || hw.bytesPerElement || 2)) * eSram / 1e6;
    const dramUJ = bytes * eDramByte / 1e6;
    const staticUJ = staticW * best.timeUs; // W * us = uJ
    return { opName: shape.opName, model: shape.model, macUJ, sramUJ, dramUJ, staticUJ, energyUJ: macUJ + sramUJ + dramUJ + staticUJ };
  });
  const total = byOpRaw.reduce((a,b)=>a+b.energyUJ,0);
  const totalTimeUs = pairs.reduce((a,p)=>a+p.best.timeUs,0);
  return {
    totalEnergyUJ: total,
    totalMacEnergyUJ: byOpRaw.reduce((a,b)=>a+b.macUJ,0),
    totalSramEnergyUJ: byOpRaw.reduce((a,b)=>a+b.sramUJ,0),
    totalDramEnergyUJ: byOpRaw.reduce((a,b)=>a+b.dramUJ,0),
    totalStaticEnergyUJ: byOpRaw.reduce((a,b)=>a+b.staticUJ,0),
    edp: total * totalTimeUs,
    byOp: byOpRaw.sort((a,b)=>b.energyUJ-a.energyUJ).map(o=>({ opName:o.opName, model:o.model, energyUJ:o.energyUJ, energyPercent: total ? o.energyUJ/total*100 : 0 }))
  };
}
export function energyMarkdown(e?: EnergySummary): string {
  if (!e) return "에너지 추정 데이터가 없습니다.";
  return `# 6. 에너지 추정\n\n전체 에너지: ${e.totalEnergyUJ.toFixed(2)} uJ\n\n- MAC 에너지: ${e.totalMacEnergyUJ.toFixed(2)} uJ\n- SRAM 에너지: ${e.totalSramEnergyUJ.toFixed(2)} uJ\n- DRAM 에너지: ${e.totalDramEnergyUJ.toFixed(2)} uJ\n- 정적 에너지: ${e.totalStaticEnergyUJ.toFixed(2)} uJ\n- EDP: ${e.edp.toFixed(2)} uJ*us\n\n## 에너지 사용량 상위 연산\n` + e.byOp.slice(0,8).map((o,i)=>`${i+1}. ${o.model}.${o.opName}: ${o.energyUJ.toFixed(2)} uJ (${o.energyPercent.toFixed(1)}%)`).join("\n");
}
