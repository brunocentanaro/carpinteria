import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      return NextResponse.json({ error: "No items in payload" }, { status: 400 });
    }
    const result = await callPython({
      action: "lista_precios_confirm",
      items: body.items,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
