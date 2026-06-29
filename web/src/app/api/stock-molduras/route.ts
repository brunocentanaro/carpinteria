import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";

function pironeSession(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  return session?.brandId === "pirone" || session?.allAccess ? session : null;
}

export async function GET(req: NextRequest) {
  if (!pironeSession(req)) return NextResponse.json({ error: "Acceso exclusivo de Pirone" }, { status: 403 });
  return NextResponse.json(await callPython({
    action: "molduras_stock_list",
    code: req.nextUrl.searchParams.get("code") || undefined,
  }));
}

export async function POST(req: NextRequest) {
  const session = pironeSession(req);
  if (!session) return NextResponse.json({ error: "Acceso exclusivo de Pirone" }, { status: 403 });
  const body = await req.json();
  if (typeof body?.operation === "string") {
    const result = await callPython({
      action: "molduras_stock_operation",
      operation: body.operation,
      payload: body.payload || {},
      updated_by: session.user,
    });
    if (typeof result.error === "string") {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  }
  const adjustmentTypes = new Set(["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "DESCARTE"]);
  if (adjustmentTypes.has(String(body?.type || "")) && !session.allAccess) {
    return NextResponse.json(
      { error: "Solo Juan Pirone puede realizar ajustes de stock" },
      { status: 403 },
    );
  }
  try {
    const result = await callPython({
      action: "molduras_stock_movement",
      movement: body,
      updated_by: session.user,
    });
    if (typeof result.error === "string") {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo registrar el movimiento";
    return NextResponse.json({ error: message.replace(/^Python exited \d+: /, "").trim() }, { status: 400 });
  }
}
