import { NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export async function GET() {
  try {
    const result = await callPython({ action: "prices" });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
