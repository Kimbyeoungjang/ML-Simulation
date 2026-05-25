const crcTable = (() => { const t = new Uint32Array(256); for (let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i]=c>>>0; } return t; })();
function crc32(buf: Buffer): number { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosDateTime(d = new Date()) { const time = (d.getHours()<<11) | (d.getMinutes()<<5) | Math.floor(d.getSeconds()/2); const date = ((d.getFullYear()-1980)<<9) | ((d.getMonth()+1)<<5) | d.getDate(); return { time, date }; }
function u16(n:number){ const b=Buffer.alloc(2); b.writeUInt16LE(n&0xffff,0); return b; } function u32(n:number){ const b=Buffer.alloc(4); b.writeUInt32LE(n>>>0,0); return b; }

export function safeZipEntryName(rawName: string): string {
  const parts = String(rawName ?? "")
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]:)?\/+/, "")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  const cleaned = parts.map((part) => part.replace(/[^A-Za-z0-9가-힣_. -]+/g, "_").replace(/^\.+$/g, "_").slice(0, 180) || "_");
  return cleaned.join("/") || "artifact";
}

export function createZip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0; const dt = dosDateTime();
  const used = new Set<string>();
  for (const [rawName, content] of Object.entries(files)) {
    let name = safeZipEntryName(rawName);
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      let i = 2;
      while (used.has(`${base}_${i}${ext}`)) i++;
      name = `${base}_${i}${ext}`;
    }
    used.add(name);
    const nameBuf = Buffer.from(name); const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8"); const crc = crc32(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(0), u16(dt.time), u16(dt.date), u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), nameBuf, data]);
    locals.push(local);
    const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dt.time), u16(dt.date), u32(crc), u32(data.length), u32(data.length), u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuf]);
    centrals.push(central); offset += local.length;
  }
  const centralDir = Buffer.concat(centrals); const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length), u32(centralDir.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, centralDir, end]);
}
