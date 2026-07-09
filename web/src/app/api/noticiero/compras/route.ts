import { NextResponse } from "next/server";
import { getPublicCalls, PURCHASE_SEARCHES } from "@/lib/compras-estatales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({
      calls: await getPublicCalls(),
      fetchedAt: new Date().toISOString(),
      source: "https://www.comprasestatales.gub.uy/consultas/",
      filters: PURCHASE_SEARCHES.map((item) => item.category),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo consultar Compras Estatales" }, { status: 502 });
  }
}
