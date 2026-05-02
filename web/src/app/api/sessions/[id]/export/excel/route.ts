import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink } from "fs/promises";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/sessions/:id/export/excel
// Generates the workbook on the Python side and streams it back as xlsx.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let xlsxPath = "";
  try {
    const { id } = await params;
    const result = (await callPython({
      action: "export_excel_session",
      session_id: id,
    })) as Record<string, string>;

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    xlsxPath = result.excel_path;
    const buffer = await readFile(xlsxPath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=cotizacion-${id.slice(0, 8)}.xlsx`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    if (xlsxPath) await unlink(xlsxPath).catch(() => {});
  }
}
