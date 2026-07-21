import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink } from "fs/promises";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/sessions/:id/export/docx
export async function GET(
  _req: NextRequest,
  { params }: RouteContext,
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

// Keep POST available for existing clients that already use this endpoint.
export const POST = GET;
