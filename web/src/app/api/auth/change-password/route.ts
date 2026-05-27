import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken, sessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const password = String(body?.password || "");
  if (password.length < 4) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 4 caracteres" }, { status: 400 });
  }
  const users = await callPython({
    action: "auth_users_list",
    brand_id: session.brandId,
  });
  const match = ((users.users || []) as Array<{ id: string; username: string; area: string }>).find(
    (u) => u.username === session.user && u.area === session.area,
  );
  if (!match) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  const result = await callPython({
    action: "auth_users_update",
    user_id: match.id,
    password,
  });
  if (result?.error) return NextResponse.json(result, { status: 400 });

  const nextSession = { ...session, mustChangePassword: false };
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, sessionToken(nextSession), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
