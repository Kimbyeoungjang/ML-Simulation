import { compactJobForList, readJob } from "@/server/jobStore";

export const dynamic = "force-dynamic";

function isNoisyPythonNotFoundLine(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.includes("python3") && (
    lower.includes("9009") ||
    lower.includes("not recognized") ||
    lower.includes("not found") ||
    lower.includes("command not found") ||
    lower.includes("python was not found")
  );
}

function sanitizeLogLines(lines: string[]): string[] {
  const kept = lines.filter(line => !isNoisyPythonNotFoundLine(line));
  const hidden = lines.length - kept.length;
  if (hidden > 0) kept.push(`(${hidden}개 Windows python3 명령 미탐색 오류는 실시간 콘솔에서 숨겼습니다.)`);
  return kept;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const tail = Math.min(Math.max(Number(url.searchParams.get("tail") ?? 200), 20), 5000);
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const tick = async () => {
        if (closed) return;
        try {
          const job = await readJob(id);
          const summary = compactJobForList(job);
          send("job", { ...summary, logs: sanitizeLogLines((job.logs ?? []).slice(-tail)), warnings: (job.warnings ?? []).slice(-20), error: job.error });
          if (["succeeded", "succeeded_with_warnings", "failed", "cancelled", "skipped_external_tool"].includes(job.status)) { send("done", { status: job.status }); controller.close(); closed = true; return; }
        } catch (e:any) { send("error", { message: e.message }); controller.close(); closed = true; return; }
        setTimeout(tick, 1000);
      };
      await tick();
    },
    cancel() { closed = true; }
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
