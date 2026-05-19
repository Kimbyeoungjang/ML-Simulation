export type ZipContent = string | Buffer;

export interface CreateZipOptions {
  /** Deterministic by default so release archives get stable checksums. */
  date?: Date;
}

const ZIP_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = ZIP_EPOCH): { time: number; date: number } {
  const d = new Date(Math.max(ZIP_EPOCH.getTime(), date.getTime()));
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const dosDate = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date: dosDate };
}

function u16(n: number): Buffer {
  const b = Buffer.allocUnsafe(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

export function normalizeZipPath(rawName: string): string {
  const normalized = rawName
    .replace(/\\/g, "/")
    .replace(/^[A-Za-z]:\/+/, "")
    .replace(/^\/+/, "");
  const parts = normalized.split("/").filter(part => part.length > 0 && part !== "." && part !== "..");
  return parts.join("/");
}

export function createZip(files: Record<string, ZipContent>, options: CreateZipOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  const dt = dosDateTime(options.date);

  const entries = Object.entries(files)
    .map(([rawName, content]) => ({ name: normalizeZipPath(rawName), content }))
    .filter(entry => entry.name.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  const seen = new Set<string>();
  for (const { name, content } of entries) {
    if (seen.has(name)) throw new Error(`duplicate zip entry after path normalization: ${name}`);
    seen.add(name);

    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const crc = crc32(data);

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(dt.time),
      u16(dt.date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      data,
    ]);
    locals.push(local);

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(dt.time),
      u16(dt.date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(centrals.length),
    u16(centrals.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, end]);
}
