import type { HardwareConfig, MatmulShape, TileCandidateResult } from "@/types/domain";
export function validateTile(hw: HardwareConfig, shape: MatmulShape, c: TileCandidateResult): string[] {
  const warnings = [...c.warnings];
  if (c.tileM <= 0 || c.tileN <= 0 || c.tileK <= 0) warnings.push("타일 차원은 모두 양수여야 합니다");
  if (c.tileK % 8 !== 0) warnings.push("tileK가 8의 배수가 아니어서 vectorized lowering 효율이 낮아질 수 있습니다");
  if (c.tileM > hw.arrayRows * 2 || c.tileN > hw.arrayCols * 2) warnings.push("타일이 배열 크기에 비해 커서 startup/buffer 압력이 커질 수 있습니다");
  if (c.sramBytes > hw.sramKB * 1024 * 0.8) warnings.push("SRAM 사용량이 설정된 로컬 메모리의 80%를 초과합니다");
  if (shape.m < c.tileM / 2 || shape.n < c.tileN / 2) warnings.push("작은 경계 타일로 인해 dispatch/padding 오버헤드가 발생할 수 있습니다");
  if (hw.doubleBuffering && c.sramBytes * 2 > hw.sramKB * 1024) warnings.push("double buffering을 적용하면 SRAM을 초과합니다");
  return Array.from(new Set(warnings));
}
export function validityMarkdown(hw: HardwareConfig, shapes: MatmulShape[], bests: TileCandidateResult[]): string {
  const byId = new Map(shapes.map(s=>[s.id,s]));
  const lines = bests.map(b => {
    const s = byId.get(b.shapeId)!;
    const warnings = validateTile(hw, s, b);
    return `- ${b.model}.${b.opName} ${b.tileM}x${b.tileN}x${b.tileK}: ${warnings.length ? warnings.join("; ") : "유효"}`;
  });
  return `# 8. 타일 유효성 검사\n\n${lines.join("\n")}`;
}
