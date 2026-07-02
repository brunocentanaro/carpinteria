import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";

function pironeSession(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  return session?.brandId === "pirone" || session?.allAccess ? session : null;
}

function authenticatedSession(req: NextRequest) {
  return readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
}

export async function GET(req: NextRequest) {
  const session = authenticatedSession(req);
  if (!session) return NextResponse.json({ error: "Sesión requerida" }, { status: 401 });
  const result = await callPython({
    action: "molduras_stock_list",
    code: req.nextUrl.searchParams.get("code") || undefined,
  });
  if (session.brandId === "casa") {
    const products = Array.isArray(result.products) ? result.products : [];
    const stock = Array.isArray(result.stock) ? result.stock : [];
    return NextResponse.json({
      products: products.map((product: Record<string, unknown>) => ({
        code: product.code,
        description: product.description,
        family: product.family,
        material: product.material,
        width_mm: 0,
        height_mm: 0,
        price_meter_iva: 0,
        price_varilla_iva: 0,
        jit_min_quantity: 0,
      })),
      stock: stock.map((row: Record<string, unknown>) => ({
        code: row.code,
        description: row.description,
        family: row.family,
        material: row.material,
        width_mm: 0,
        height_mm: 0,
        price_meter_iva: 0,
        price_varilla_iva: 0,
        jit_min_quantity: 0,
        complete_quantity: row.complete_quantity,
        fraction_quantity: 0,
        total_units: row.complete_quantity,
      })),
      locations: [],
      movements: [],
      reservations: [],
    });
  }
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = pironeSession(req);
  if (!session) return NextResponse.json({ error: "La Casa tiene acceso de solo lectura al stock de fábrica" }, { status: 403 });
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
