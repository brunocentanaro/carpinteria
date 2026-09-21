import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { isBrandEnvironmentId } from "@/lib/brand-environments";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  try {
    const auth = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
    if (!auth) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const params = req.nextUrl.searchParams;
    const brandId = params.get("brandId") || auth.brandId;
    if (!isBrandEnvironmentId(brandId)) return NextResponse.json({ error: "Empresa no válida" }, { status: 400 });
    if (brandId !== auth.brandId && !auth.allAccess) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    let payload: Record<string, unknown>;
    if (req.method === "GET") {
      const id = params.get("id");
      payload = id ? { action: "internal_request_get", request_id: id } : { action: "internal_requests_list", limit: Number(params.get("limit") || 50) || 50 };
    } else {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
      if (req.method === "POST") payload = { action: "internal_request_create", values: body };
      else {
        if (typeof body.id !== "string" || !body.id.trim() || (typeof body.text === "string") === (typeof body.status === "string")) {
          return NextResponse.json({ error: "Indicá el pedido y un mensaje o estado" }, { status: 400 });
        }
        payload = typeof body.text === "string" ? { action: "internal_request_message", request_id: body.id, text: body.text } : { action: "internal_request_status", request_id: body.id, status: body.status };
      }
    }
    const result = await callPython({ ...payload, brand_id: brandId, actor: auth.user, actor_area: auth.area, all_access: !!auth.allAccess });
    const status = result.error ? ([400, 403, 404].includes(Number(result.status)) ? Number(result.status) : 500) : 200;
    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo acceder al chat interno" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
