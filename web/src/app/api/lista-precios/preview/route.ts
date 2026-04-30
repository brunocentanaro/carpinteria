import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let tempPath: string | null = null;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    tempPath = join(tmpdir(), `lista-precios-${Date.now()}.pdf`);
    await writeFile(tempPath, Buffer.from(bytes));

    const result = await callPython({
      action: "lista_precios_preview",
      pdf_path: tempPath,
    });

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => {});
  }
}
