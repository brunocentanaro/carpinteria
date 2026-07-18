import { readFile, unlink } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";

import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (!session || (session.brandId !== "casa" && !session.allAccess)) {
    return NextResponse.json({ error: "Acceso de La Casa requerido" }, { status: 403 });
  }

  let excelPath = "";
  try {
    const result = await callPython({
      action: "accounting_daily_report",
      date: req.nextUrl.searchParams.get("date") || "",
      cashier: session.user,
    }) as { excel_path: string; filename: string };
    excelPath = result.excel_path;
    const buffer = await readFile(excelPath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo generar el reporte";
    return NextResponse.json({ error: message.replace(/^Python exited \d+: /, "").trim() }, { status: 400 });
  } finally {
    if (excelPath) await unlink(excelPath).catch(() => {});
  }
}
