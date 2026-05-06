export const ceilDiv = (a: number, b: number) => Math.ceil(a / b);
export const product = (xs: number[]) => xs.reduce((a, b) => a * b, 1);
export const mean = (xs: number[]) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const parseNumList = (s: string) => s.split(/[\s,]+/).map(v=>Number(v.trim())).filter(v=>Number.isFinite(v) && v>0);
export const fmt = (n: number, digits = 2) => Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: digits }) : "-";
