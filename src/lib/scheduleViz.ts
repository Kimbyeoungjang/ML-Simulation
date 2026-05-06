import type { MatmulShape, TileCandidateResult, HardwareConfig } from "@/types/domain";
function rect(x:number,y:number,w:number,h:number,fill:string,stroke="#222") { return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`; }
export function tileScheduleSvg(hw: HardwareConfig, shape: MatmulShape, tile: TileCandidateResult): string {
  const W = 720, H = 420, ox = 50, oy = 55, gw = 430, gh = 260;
  const mt = Math.ceil(shape.m / tile.tileM), nt = Math.ceil(shape.n / tile.tileN);
  const cellW = gw / nt, cellH = gh / mt;
  let cells = "";
  for (let i=0;i<mt;i++) for (let j=0;j<nt;j++) {
    const edge = (i === mt-1 && shape.m % tile.tileM !== 0) || (j === nt-1 && shape.n % tile.tileN !== 0);
    cells += rect(ox+j*cellW, oy+i*cellH, cellW, cellH, edge ? "#f4c2c2" : "#cfe8ff");
  }
  const arrayW = 150, arrayH = 150;
  const activeW = arrayW * Math.min(tile.tileN, hw.arrayCols) / hw.arrayCols;
  const activeH = arrayH * Math.min(tile.tileM, hw.arrayRows) / hw.arrayRows;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="white"/>
  <text x="24" y="28" font-family="Arial" font-size="20" font-weight="bold">Tile schedule: ${shape.opName}</text>
  <text x="${ox}" y="${oy-14}" font-family="Arial" font-size="13">M×N output tiles: ${mt} × ${nt}, K reduction tiles: ${Math.ceil(shape.k/tile.tileK)}</text>
  ${cells}
  <text x="${ox}" y="${oy+gh+24}" font-family="Arial" font-size="13">Blue = full tile, red = boundary/padded tile</text>
  <text x="530" y="70" font-family="Arial" font-size="15" font-weight="bold">Array occupancy</text>
  ${rect(530,90,arrayW,arrayH,"#eee")}
  ${rect(530,90,activeW,activeH,"#b7e4c7")}
  <text x="530" y="260" font-family="Arial" font-size="13">Array: ${hw.arrayRows}×${hw.arrayCols}</text>
  <text x="530" y="280" font-family="Arial" font-size="13">Tile: ${tile.tileM}×${tile.tileN}×${tile.tileK}</text>
  <text x="530" y="300" font-family="Arial" font-size="13">Utilization: ${(tile.utilization*100).toFixed(1)}%</text>
  <text x="530" y="320" font-family="Arial" font-size="13">Padding: ${(tile.paddingRatio*100).toFixed(1)}%</text>
</svg>`;
}
