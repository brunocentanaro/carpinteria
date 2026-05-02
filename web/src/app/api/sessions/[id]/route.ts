import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await callPython({ action: "session_get", session_id: id });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const payload: Record<string, unknown> = { action: "session_update", session_id: id };
    if ("color_default" in body) payload.color_default = body.color_default;
    if ("payment_days" in body) payload.payment_days = body.payment_days;
    if ("destination" in body) payload.destination = body.destination;
    const result = await callPython(payload);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
