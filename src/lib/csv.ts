import type { MatmulShape } from "@/types/domain";

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some(Boolean) && !String(r[0] ?? "").trim().startsWith("#"));
}


export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => { row[header] = cells[index] ?? ""; });
    return row;
  });
}

function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseNumericCell(value: string | undefined, label: string, row: number, fallback?: number): number {
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Invalid ${label} at CSV row ${row}`);
  }
  const cleaned = value.replace(/,/g, "").replace(/%$/, "").trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label} at CSV row ${row}`);
  return parsed;
}

export function parseShapesCsv(text: string): MatmulShape[] {
  const rows = parseCsvRows(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  for (const required of ["m", "n", "k"]) if (idx(required) < 0) throw new Error(`CSV missing column: ${required}`);
  return rows.slice(1).map((cells, i) => {
    const rowNo = i + 2;
    const num = (name: string, fallback?: number) => parseNumericCell(cells[idx(name)], name, rowNo, fallback);
    const str = (name: string, fallback: string) => {
      const j = idx(name);
      return j >= 0 && cells[j] ? cells[j] : fallback;
    };
    return {
      id: str("id", `csv_${i}`),
      model: str("model", "csv-model"),
      opName: str("op_name", str("opname", `op_${i}`)),
      m: num("m"),
      n: num("n"),
      k: num("k"),
      dtypeBytes: num("dtype_bytes", 2),
      source: "csv"
    };
  });
}

export function shapesToCsv(shapes: MatmulShape[]): string {
  const rows = [
    ["id", "model", "op_name", "m", "n", "k", "dtype_bytes", "source"],
    ...shapes.map((s) => [s.id, s.model, s.opName, s.m, s.n, s.k, s.dtypeBytes, s.source ?? "manual"])
  ];
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

export const __csvInternalsForTests = { parseCsvRows, parseCsvRecords };
