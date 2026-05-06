import { NextResponse } from "next/server";
import { systemStatus } from "@/server/systemStatus";
export async function GET() { return NextResponse.json(systemStatus()); }
