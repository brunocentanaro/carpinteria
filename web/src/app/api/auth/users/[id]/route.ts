import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 60;

function requireAdmin(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  return session?.area === "administracion" ? session : null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireAdmin(req);
  if (!session) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const result = await callPython({
    action: "auth_users_update",
    user_id: id,
    active: body?.active,
    password: body?.password,
  });
  return NextResponse.json(result, { status: result?.error ? 400 : 200 });
}
