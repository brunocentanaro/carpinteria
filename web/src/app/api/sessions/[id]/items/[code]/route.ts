import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 120;

// PATCH /api/sessions/:id/items/:code
// body: { fields: { color?, material?, thickness_mm?, quantity?, name?, edge_banding? } }
//
// Patch one or more whitelisted fields on an item, then recalculate.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  try {
    const { id, code } = await params;
    const body = await req.json().catch(() => ({}));
    const result = await callPython({
      action: "item_update",
      session_id: id,
      item_code: code,
      fields: body?.fields ?? {},
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/sessions/:id/items/:code
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; code: string }> },
) {
  try {
    const { id, code } = await params;
    const result = await callPython({
      action: "item_delete",
      session_id: id,
      item_code: code,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
