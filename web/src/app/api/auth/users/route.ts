import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 60;

function requireAdmin(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  return session?.area === "administracion" ? session : null;
}

export async function GET(req: NextRequest) {
  const session = requireAdmin(req);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const result = await callPython({
    action: "auth_users_list",
    brand_id: searchParams.get("brandId") || undefined,
  });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = requireAdmin(req);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const result = await callPython({
    action: "auth_users_create",
    username: body?.username,
    password: body?.password,
    brand_id: body?.brandId,
    area: body?.area,
  });
  return NextResponse.json(result, { status: result?.error ? 400 : 200 });
}
