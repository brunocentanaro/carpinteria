import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const tempPaths: string[] = [];
  try {
    const { id } = await params;
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    if (files.length === 0) {
      return NextResponse.json({ error: "no files provided" }, { status: 400 });
    }
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split(".").pop() || "bin";
      const path = join(tmpdir(), `pliego-${Date.now()}-${i}.${ext}`);
      await writeFile(path, Buffer.from(await file.arrayBuffer()));
      tempPaths.push(path);
    }
    const result = await callPython({
      action: "session_ingest_pliego",
      session_id: id,
      file_paths: tempPaths,
    });
    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    for (const p of tempPaths) await unlink(p).catch(() => {});
  }
}
