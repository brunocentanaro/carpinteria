import { NextRequest, NextResponse } from "next/server";

import { callPython } from "@/lib/python";
import { AUTH_AREAS } from "@/lib/auth";
import { isBrandEnvironmentId } from "@/lib/brand-environments";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const brandId = String(body?.brandId || "");
  const area = String(body?.area || "");
  const username = String(body?.username || "");
  if (!isBrandEnvironmentId(brandId) || !(area in AUTH_AREAS) || !username.trim()) {
    return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
  }
  const result = await callPython({
    action: "auth_password_reset_request",
    brand_id: brandId,
    area,
    username,
  });
  return NextResponse.json(result);
}
