import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";

function administrator(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (!session || (session.area !== "administracion" && !session.allAccess)) return null;
  return session;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo completar la operación";
  return NextResponse.json({ error: message.replace(/^Python exited \d+: /, "").trim() }, { status: 400 });
}

export async function GET(req: NextRequest) {
  if (!administrator(req)) return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  const resource = req.nextUrl.searchParams.get("resource") || "inventory";
  try {
    if (resource === "inventory") {
      return NextResponse.json(await callPython({ action: "inventory_list" }));
    }
    if (resource === "ucfe") {
      return NextResponse.json(await callPython({
        action: "ucfe_received_list",
        mapping_status: req.nextUrl.searchParams.get("status") || undefined,
        limit: Number(req.nextUrl.searchParams.get("limit") || 200),
      }));
    }
    return NextResponse.json({ error: "Recurso inválido" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  const session = administrator(req);
  if (!session) return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  try {
    const body = await req.json();
    const operation = String(body?.operation || "");
    let result: Record<string, unknown>;
    if (operation === "product") {
      result = await callPython({ action: "inventory_product_upsert", product: body.product || {}, updated_by: session.user });
    } else if (operation === "movement") {
      result = await callPython({ action: "inventory_movement", movement: body.movement || {}, updated_by: session.user });
    } else if (operation === "replenishment") {
      result = await callPython({ action: "inventory_replenishment", settings: body.settings || {}, updated_by: session.user });
    } else if (operation === "sync") {
      result = await callPython({
        action: "ucfe_received_sync",
        start: body.start,
        end: body.end,
        company_id: body.company_id || "478",
        updated_by: session.user,
      });
    } else if (operation === "mapping") {
      result = await callPython({
        action: "ucfe_item_mapping",
        operation: body.mapping_operation,
        source_key: body.source_key,
        inventory_product_id: body.inventory_product_id,
        conversion_factor: body.conversion_factor,
        location_code: body.location_code,
        note: body.note,
        updated_by: session.user,
      });
    } else {
      return NextResponse.json({ error: "Operación inválida" }, { status: 400 });
    }
    if (typeof result.error === "string") return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
