import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, canEditAccounting, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";

function casaSession(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (!session) return null;
  if (session.brandId !== "casa" && !session.allAccess) return null;
  return session;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo completar la operacion";
  return NextResponse.json({ error: message.replace(/^Python exited \d+: /, "").trim() }, { status: 400 });
}

export async function GET(req: NextRequest) {
  const session = casaSession(req);
  if (!session) return NextResponse.json({ error: "Acceso de La Casa requerido" }, { status: 403 });
  const view = req.nextUrl.searchParams.get("view") || "monthly";
  if (view === "annual" && session.area !== "administracion" && !session.allAccess) {
    return NextResponse.json({ error: "Acceso administrativo requerido" }, { status: 403 });
  }
  try {
    return NextResponse.json(await callPython({
      action: "accounting_list",
      year: Number(req.nextUrl.searchParams.get("year") || new Date().getFullYear()),
      month: Number(req.nextUrl.searchParams.get("month") || new Date().getMonth() + 1),
    }));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  const session = casaSession(req);
  if (!session) return NextResponse.json({ error: "Acceso de La Casa requerido" }, { status: 403 });
  try {
    const body = await req.json();
    const operation = String(body?.operation || "");
    const accountingOnlyOperations = new Set(["replace_movement", "correct_movement", "correct_movement_amount", "correct_movement_date", "delete_movement", "supplier_invoice", "supplier_payment", "supplier_sync", "labor_provision", "sale_cost", "close_day", "classify_supplier_invoice"]);
    if (accountingOnlyOperations.has(operation) && !canEditAccounting(session)) {
      return NextResponse.json({ error: "Solo administracion contable puede realizar esta operacion" }, { status: 403 });
    }
    let result: Record<string, unknown>;
    if (operation === "movement") {
      result = await callPython({ action: "accounting_movement", movement: body.movement || {}, updated_by: session.user });
    } else if (operation === "replace_movement") {
      result = await callPython({ action: "accounting_replace_movement", movement_id: body.movement_id, replacements: body.replacements || [], updated_by: session.user });
    } else if (operation === "correct_movement") {
      result = await callPython({ action: "accounting_correct_movement", movement_id: body.movement_id, direction: body.direction, updated_by: session.user });
    } else if (operation === "correct_movement_amount") {
      result = await callPython({ action: "accounting_correct_movement_amount", movement_id: body.movement_id, amount: body.amount, updated_by: session.user });
    } else if (operation === "correct_movement_date") {
      result = await callPython({ action: "accounting_correct_movement_date", movement_id: body.movement_id, date: body.date, updated_by: session.user });
    } else if (operation === "delete_movement") {
      result = await callPython({ action: "accounting_delete_movement", movement_id: body.movement_id, updated_by: session.user });
    } else if (operation === "supplier_invoice") {
      result = await callPython({ action: "accounting_supplier_invoice", invoice: body.invoice || {}, updated_by: session.user });
    } else if (operation === "supplier_payment") {
      result = await callPython({ action: "accounting_supplier_payment", payment: body.payment || {}, updated_by: session.user });
    } else if (operation === "daily_supplier_payment") {
      result = await callPython({ action: "accounting_daily_supplier_payment", payment: body.payment || {}, updated_by: session.user });
    } else if (operation === "labor_provision") {
      result = await callPython({ action: "accounting_labor_provision", provision: body.provision || {}, updated_by: session.user });
    } else if (operation === "sale_cost") {
      result = await callPython({ action: "accounting_sale_cost", sale_cost: body.sale_cost || {}, updated_by: session.user });
    } else if (operation === "close_day") {
      result = await callPython({ action: "accounting_close_day", date: body.date, updated_by: session.user });
    } else if (operation === "classify_supplier_invoice") {
      result = await callPython({ action: "accounting_classify_supplier_invoice", invoice_id: body.invoice_id, classification: body.classification, updated_by: session.user });
    } else if (operation === "supplier_sync") {
      result = await callPython({ action: "accounting_supplier_sync", updated_by: session.user });
    } else {
      return NextResponse.json({ error: "Operacion invalida" }, { status: 400 });
    }
    if (typeof result.error === "string") return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
