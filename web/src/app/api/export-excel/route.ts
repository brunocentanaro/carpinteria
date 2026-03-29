import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";
import { readFile, unlink } from "fs/promises";

export async function POST(req: NextRequest) {
  let excelPath = "";
  try {
    const body = await req.json();
    const result = await callPython({ action: "export_excel", ...body }) as Record<string, string>;

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    excelPath = result.excel_path;
    const buffer = await readFile(excelPath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=cotizacion.xlsx",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    if (excelPath) {
      await unlink(excelPath).catch(() => {});
    }
  }
}
