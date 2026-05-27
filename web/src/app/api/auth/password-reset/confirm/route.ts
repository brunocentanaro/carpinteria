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
  const code = String(body?.code || "");
  const password = String(body?.password || "");
  if (!isBrandEnvironmentId(brandId) || !(area in AUTH_AREAS) || !username.trim() || !code.trim() || !password) {
    return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
  }
  const result = await callPython({
    action: "auth_password_reset_confirm",
    brand_id: brandId,
    area,
    username,
    code,
    password,
  });
  return NextResponse.json(result, { status: result?.error ? 400 : 200 });
}
