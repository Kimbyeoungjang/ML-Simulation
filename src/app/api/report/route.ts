import { NextResponse } from "next/server";
import { estimateAll } from "@/lib/estimator";
import { formatZodError, parseSearchRequest } from "@/lib/validation";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const res = estimateAll(parseSearchRequest(body));
    return new NextResponse(res.artifacts.reportMarkdown, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  } catch (error) {
    return NextResponse.json({ error: "Invalid report request", detail: formatZodError(error) }, { status: 400 });
  }
}
