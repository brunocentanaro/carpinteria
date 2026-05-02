import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink } from "fs/promises";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 120;

// POST /api/sessions/:id/export/docx
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let docxPath = "";
  try {
    const { id } = await params;
    const result = (await callPython({
      action: "export_docx_session",
      session_id: id,
    })) as Record<string, string>;

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    docxPath = result.docx_path;
    const buffer = await readFile(docxPath);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename=cotizacion-${id.slice(0, 8)}.docx`,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    if (docxPath) await unlink(docxPath).catch(() => {});
  }
}
