import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 120;

// PATCH /api/sessions/:id/items/:code/hardware
// body: { hardware_code: string, quantity: number }
//
// Set / add / remove a hardware row on the item. Quantity 0 removes.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  try {
    const { id, code } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await callPython({
      action: "hardware_set_quantity",
      session_id: id,
      item_code: code,
      hardware_code: body?.hardware_code,
      quantity: body?.quantity,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
