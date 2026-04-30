import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  try {
    const result = await callPython({ action: "hardware_prices_get" });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const code = body?.code;
    const price = body?.price;
    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "missing code" }, { status: 400 });
    }
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "invalid price" }, { status: 400 });
    }
    const result = await callPython({
      action: "hardware_prices_set",
      code,
      price,
      updated_by: body?.updated_by ?? "",
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
