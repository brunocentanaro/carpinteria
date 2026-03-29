import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";
import { readFile, unlink } from "fs/promises";

export async function POST(req: NextRequest) {
  let docxPath = "";
  try {
    const body = await req.json();
    const result = await callPython({ action: "export_docx", ...body }) as Record<string, string>;

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    docxPath = result.docx_path;
    const buffer = await readFile(docxPath);

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": "attachment; filename=cotizacion_licitacion.docx",
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    if (docxPath) {
      await unlink(docxPath).catch(() => {});
    }
  }
}
