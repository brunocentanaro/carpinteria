import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";

// GET /api/images?key=<objectKey>&sessionId=<id>
// Resolves a short-lived presigned URL for a stored upload and redirects to it,
// so <img src="/api/images?key=..."> renders the private object directly.
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const sessionId = req.nextUrl.searchParams.get("sessionId") || "";
  if (!key) {
    return NextResponse.json({ error: "missing key" }, { status: 400 });
  }
  try {
    const result = (await callPython({
      action: "image_url",
      key,
      session_id: sessionId,
    })) as { url?: string; error?: string };
    if (!result.url) {
      return NextResponse.json(
        { error: result.error || "not found" },
        { status: 404 },
      );
    }
    return NextResponse.redirect(result.url, 302);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
