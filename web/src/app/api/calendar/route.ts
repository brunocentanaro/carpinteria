import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";
import { isBrandEnvironmentId } from "@/lib/brand-environments";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(req: NextRequest) {
  try {
    const auth = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
    if (!auth) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const params = req.nextUrl.searchParams;
    const brandId = params.get("brandId") || auth.brandId;
    if (!isBrandEnvironmentId(brandId)) return NextResponse.json({ error: "Empresa no válida" }, { status: 400 });
    if (brandId !== auth.brandId && !auth.allAccess) {
      return NextResponse.json({ error: "No autorizado para esta empresa" }, { status: 403 });
    }
    let payload: Record<string, unknown>;
    if (req.method === "GET") {
      payload = { action: "employee_calendar_list", month: params.get("month"), employee_id: params.get("employee") || "" };
    } else {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return NextResponse.json({ error: "Datos de tarea no válidos" }, { status: 400 });
      }
      const { id, ...values } = body;
      if (req.method === "PATCH" && (typeof id !== "string" || !id.trim())) {
        return NextResponse.json({ error: "Falta identificar la tarea" }, { status: 400 });
      }
      payload = { action: "employee_calendar_save", values, task_id: req.method === "PATCH" ? id : "" };
    }
    const result = await callPython({ ...payload, brand_id: brandId, actor: auth.user });
    return NextResponse.json(result, { status: result.error ? (result.status === 404 ? 404 : result.status === 400 ? 400 : 500) : 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "No se pudo guardar o cargar el calendario";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
