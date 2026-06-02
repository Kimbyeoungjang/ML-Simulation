import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { jobDir } from "@/server/workspace";

export async function GET(_: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await ctx.params;
  const safe = path.basename(name);
  const target = path.join(jobDir(id), safe);
  const s = await stat(target).catch(() => null);
  if (!s?.isFile()) return Response.json({ error: "artifact not found" }, { status: 404 });
  const stream = Readable.toWeb(createReadStream(target)) as ReadableStream;
  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-length": String(s.size),
      "cache-control": "no-store",
    },
  });
}
