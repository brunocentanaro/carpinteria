import { NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/catalog/hardware
// Curated hardware codes (used to populate the "agregar herraje" select).
export async function GET() {
  try {
    const result = await callPython({ action: "hardware_catalog_list" });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
