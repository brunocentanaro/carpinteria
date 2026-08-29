import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";

function adminCasaSession(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (!session) return null;
  if (session.brandId !== "casa" && !session.allAccess) return null;
  if (session.area !== "administracion" && !session.allAccess) return null;
  return session;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo completar la operacion";
  return NextResponse.json({ error: message.replace(/^Python exited \d+: /, "").trim() }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const session = adminCasaSession(req);
  if (!session) return NextResponse.json({ error: "Acceso administrativo de La Casa requerido" }, { status: 403 });
  try {
    return NextResponse.json(await callPython({
      action: "fiserv_panel",
      year: Number(req.nextUrl.searchParams.get("year") || new Date().getFullYear()),
      month: Number(req.nextUrl.searchParams.get("month") || new Date().getMonth() + 1),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  const session = adminCasaSession(req);
  if (!session) return NextResponse.json({ error: "Acceso administrativo de La Casa requerido" }, { status: 403 });
  try {
    const body = await req.json().catch(() => ({}));
    const result = await callPython({
      action: "fiserv_sync",
      lookback_days: Number(body?.lookback_days) || 3,
      updated_by: session.user,
    });
    if (result && typeof (result as Record<string, unknown>).error === "string") {
      return NextResponse.json({ error: (result as Record<string, unknown>).error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
