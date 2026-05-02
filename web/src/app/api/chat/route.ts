import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sessionId = body?.session_id;
    const message = body?.message;
    if (!sessionId || !message) {
      return NextResponse.json({ error: "missing session_id or message" }, { status: 400 });
    }
    const result = await callPython({ action: "chat", session_id: sessionId, message });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
