import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";
import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const archive = searchParams.get("archive") === "1";
    const year = searchParams.get("year");
    const month = searchParams.get("month");
    const selectedBrand = searchParams.get("brandId");
    const brandId = session.allAccess && selectedBrand ? selectedBrand : session.brandId;
    const result = await callPython({
      action: archive ? "session_archive" : "session_list",
      year: year ? Number(year) : undefined,
      month: month ? Number(month) : undefined,
      current_month: !archive && !year && !month,
      user_id: session.user,
      brand_id: brandId,
      area: session.area,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
    if (!session) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const brandId = session.allAccess && body?.brandId ? body.brandId : session.brandId;
    const result = await callPython({
      action: "session_create",
      title: body?.title || "",
      user_id: session.user,
      brand_id: brandId,
      area: session.area,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
