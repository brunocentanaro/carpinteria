import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { BRAND_ENVIRONMENTS } from "@/lib/brand-environments";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({
    authenticated: true,
    session: {
      ...session,
      brand: BRAND_ENVIRONMENTS[session.brandId],
    },
  });
}
