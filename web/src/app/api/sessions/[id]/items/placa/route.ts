import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/sessions/:id/items/placa
// body: { item_code: string, placa_sku: string | null }
//
// Pin (or unpin, with sku=null) a specific catalog board on a quotation item.
// Triggers a recalculation of that item.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const itemCode = body?.item_code;
    if (!itemCode || typeof itemCode !== "string") {
      return NextResponse.json({ error: "missing item_code" }, { status: 400 });
    }
    const result = await callPython({
      action: "set_item_placa",
      session_id: id,
      item_code: itemCode,
      placa_sku: body?.placa_sku ?? null,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
