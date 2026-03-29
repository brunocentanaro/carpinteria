import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await callPython({ action: "quote_item", ...body });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
