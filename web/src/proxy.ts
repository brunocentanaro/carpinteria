import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api/auth")
  ) {
    return NextResponse.next();
  }

  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (session) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)", "/api/:path*"],
};
