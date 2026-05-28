import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 120;

// PATCH /api/sessions/:id/items/:code/pieces
// body: { piece_label: string, quantity: number }
//
// Update one piece's quantity (matched by label). Quantity 0 removes it.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  try {
    const { id, code } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await callPython({
      action: "piece_set_quantity",
      session_id: id,
      item_code: code,
      piece_label: body?.piece_label,
      quantity: body?.quantity,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/sessions/:id/items/:code/pieces
// body: { piece: { label, width_mm, height_mm, quantity, edge_sides } }
//
// Create or replace one piece by label and recalculate.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  try {
    const { id, code } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await callPython({
      action: "piece_upsert",
      session_id: id,
      item_code: code,
      piece: body?.piece,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
