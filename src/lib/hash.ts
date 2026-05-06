export function stableStringify(value: unknown, seen = new WeakSet<object>()): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return 'Infinity';
    if (value === -Infinity) return '-Infinity';
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);

  const objectValue = value as object;
  if (seen.has(objectValue)) return '"[Circular]"';
  seen.add(objectValue);

  if (Array.isArray(value)) return `[${value.map(v => stableStringify(v, seen)).join(',')}]`;

  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k], seen)}`).join(',')}}`;
}

function hashString(input: string): string {
  // Browser-safe deterministic 128-bit non-cryptographic hash.
  // This replaces node:crypto because estimator.ts is also imported by the Next.js client page.
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0xc0decafe;
  let h4 = 0x9e3779b9;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ ch, 2246822507);
    h4 = Math.imul(h4 ^ ch, 3266489909);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return [h1, h2, h3, h4]
    .map(h => (h >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

export function hashObject(value: unknown): string {
  return hashString(stableStringify(value)).slice(0, 20);
}
