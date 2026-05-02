import { NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/catalog/boards
// Returns all PLACA rows from the Activa catalog with sku + label, ready for
// a frontend dropdown (board picker).
export async function GET() {
  try {
    const result = await callPython({ action: "catalog_list_boards" });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
