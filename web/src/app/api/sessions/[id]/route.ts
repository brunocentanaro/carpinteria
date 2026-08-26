import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";
import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
    if (!auth) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const { id } = await params;
    const result = await callPython({ action: "session_get", session_id: id });
    const s = result.session as { user_id?: string; brand_id?: string; order_number?: string } | undefined;
    const isFactoryVisible = auth.brandId === "pirone" && s?.brand_id === "casa";
    if (s && auth.area !== "administracion" && s.user_id !== auth.user && !isFactoryVisible) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    if (s?.brand_id && s.brand_id !== auth.brandId && !auth.allAccess && !isFactoryVisible) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
    if (!auth) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const currentResult = await callPython({ action: "session_get", session_id: id });
    const current = currentResult.session as
      | {
          user_id?: string;
          brand_id?: string;
          order_number?: string;
          client_name?: string;
          client_phone?: string;
          order_summary?: string;
          payment_status?: string;
          payment_notes?: string;
          client_details_confirmed?: boolean;
          final_quote_amount?: number | null;
          approved_quote_amounts?: Record<string, number>;
          approved_quote_tax_modes?: Record<string, "plus" | "included">;
          approved_quote_price_modes?: Record<string, "unit" | "total">;
          approved_quote_quantities?: Record<string, number>;
          approved_quote_notes?: Record<string, string>;
          confirmed_quote_keys?: string[];
        }
      | undefined;
    if (!current) {
      return NextResponse.json({ error: "Cotizacion no encontrada" }, { status: 404 });
    }
    const isFactoryVisible = auth.brandId === "pirone" && current.brand_id === "casa";
    if (auth.area !== "administracion" && current.user_id !== auth.user && !isFactoryVisible) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    if (current.brand_id && current.brand_id !== auth.brandId && !auth.allAccess && !isFactoryVisible) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    const commercialFields = [
      "approval_status",
      "client_name",
      "client_phone",
      "order_summary",
      "payment_status",
      "payment_notes",
      "client_details_confirmed",
      "final_quote_amount",
      "approved_quote_amounts",
      "approved_quote_tax_modes",
      "approved_quote_price_modes",
      "approved_quote_quantities",
      "approved_quote_notes",
      "confirmed_quote_keys",
      "client_sent",
      "client_accepted",
      "deposit_amount",
      "order_number",
      "ready_to_deliver",
      "delivered",
      "final_payment_amount",
    ];
    const hasCommercialField = commercialFields.some((key) => key in body);
    const payload: Record<string, unknown> = {
      action: hasCommercialField ? "session_commercial_status" : "session_update",
      session_id: id,
    };
    if ("color_default" in body) payload.color_default = body.color_default;
    if ("payment_days" in body) payload.payment_days = body.payment_days;
    if ("destination" in body) payload.destination = body.destination;
    if ("title" in body) payload.title = body.title;
    if ("additional_services" in body) payload.additional_services = body.additional_services;
    if ("chat_note" in body) payload.chat_note = body.chat_note;
    if (hasCommercialField) {
      if ("approval_status" in body && auth.area !== "administracion") {
        return NextResponse.json({ error: "Solo administracion puede aprobar cotizaciones" }, { status: 403 });
      }
      if ("final_quote_amount" in body && auth.area !== "administracion") {
        return NextResponse.json({ error: "Solo administracion puede fijar el presupuesto definitivo" }, { status: 403 });
      }
      if (("approved_quote_amounts" in body || "approved_quote_tax_modes" in body || "approved_quote_price_modes" in body || "approved_quote_quantities" in body || "approved_quote_notes" in body) && auth.area !== "administracion") {
        return NextResponse.json({ error: "Solo administracion puede avalar precios definitivos" }, { status: 403 });
      }
      if ("approval_status" in body && auth.brandId !== "casa") {
        return NextResponse.json({ error: "La aprobacion se gestiona desde La Casa del Carpintero" }, { status: 403 });
      }
      if (body.approval_status === "approved") {
        const requestComplete =
          current.client_details_confirmed === true &&
          !!current.client_name?.trim() &&
          !!current.client_phone?.trim() &&
          !!current.order_summary?.trim();
        if (!requestComplete) {
          return NextResponse.json({ error: "Complete todos los datos obligatorios de la solicitud antes de aprobar" }, { status: 400 });
        }
      }
      const casaStepFields = ["client_sent", "client_accepted", "deposit_amount", "order_number", "delivered", "final_payment_amount"];
      const factoryStepFields = ["ready_to_deliver"];
      const resetsDownstream = "client_accepted" in body;
      if (auth.brandId !== "casa" && casaStepFields.some((key) => key in body)) {
        return NextResponse.json({ error: "Este paso se gestiona desde La Casa del Carpintero" }, { status: 403 });
      }
      if (auth.brandId !== "pirone" && !resetsDownstream && factoryStepFields.some((key) => key in body)) {
        return NextResponse.json({ error: "Este paso se gestiona desde la carpinteria" }, { status: 403 });
      }
      for (const key of commercialFields) {
        if (key in body) payload[key] = body[key];
      }
      if ("final_quote_amount" in body) {
        payload.final_quote_updated_at = new Date().toISOString();
        payload.final_quote_updated_by = auth.user;
      }
      if ("approved_quote_amounts" in body || "approved_quote_tax_modes" in body || "approved_quote_price_modes" in body || "approved_quote_quantities" in body || "approved_quote_notes" in body) {
        payload.approved_quotes_updated_at = new Date().toISOString();
        payload.approved_quotes_updated_by = auth.user;
      }
    }
    const result = await callPython(payload);
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await callPython({ action: "session_delete", session_id: id });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
