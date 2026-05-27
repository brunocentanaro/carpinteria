import { NextRequest, NextResponse } from "next/server";

import { callPython } from "@/lib/python";
import { AUTH_AREAS, AUTH_COOKIE, sessionToken, type AuthArea } from "@/lib/auth";
import { BRAND_ENVIRONMENTS, isBrandEnvironmentId } from "@/lib/brand-environments";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const brandId = String(body?.brandId || "");
  const area = String(body?.area || "");
  const user = String(body?.user || "");
  const password = String(body?.password || "");

  if (!isBrandEnvironmentId(brandId)) {
    return NextResponse.json({ error: "Ambiente invalido" }, { status: 400 });
  }
  if (!(area in AUTH_AREAS)) {
    return NextResponse.json({ error: "Area invalida" }, { status: 400 });
  }

  const auth = await callPython({
    action: "auth_login",
    brand_id: brandId,
    area,
    user,
    password,
  });
  if (auth?.error || !auth?.user) {
    return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
  }

  const userRow = auth.user as { username?: string; all_access?: boolean; must_change_password?: boolean };
  const loginUser = String(userRow?.username || user);
  const allAccess = !!userRow?.all_access;

  const res = NextResponse.json({
    ok: true,
    session: {
      brandId,
      area,
      user: loginUser,
      allAccess,
      mustChangePassword: !!userRow?.must_change_password,
      brand: BRAND_ENVIRONMENTS[brandId],
    },
  });
  res.cookies.set(AUTH_COOKIE, sessionToken({
    brandId,
    user: loginUser,
    area: area as AuthArea,
    allAccess,
    mustChangePassword: !!userRow?.must_change_password,
  }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
