import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const selectedBrand = new URL(req.url).searchParams.get("brandId");
    const brandId = session.allAccess && selectedBrand ? selectedBrand : session.brandId;
    const result = await callPython({ action: "crm_customers", brand_id: brandId });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
