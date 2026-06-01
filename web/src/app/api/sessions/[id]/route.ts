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
    const isFactoryOrder = auth.brandId === "pirone" && !!s?.order_number;
    if (s && auth.area !== "administracion" && s.user_id !== auth.user && !isFactoryOrder) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    if (s?.brand_id && s.brand_id !== auth.brandId && !auth.allAccess && !isFactoryOrder) {
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
    const commercialFields = [
      "approval_status",
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
    if (hasCommercialField) {
      if (auth.area !== "administracion") {
        return NextResponse.json({ error: "Solo administracion puede cambiar estados comerciales" }, { status: 403 });
      }
      for (const key of commercialFields) {
        if (key in body) payload[key] = body[key];
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
