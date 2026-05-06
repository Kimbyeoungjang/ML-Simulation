import { NextResponse } from "next/server";
import { runDoctor } from "@/server/doctor";
export async function GET() { return NextResponse.json(await runDoctor()); }
