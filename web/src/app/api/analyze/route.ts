import { NextRequest, NextResponse } from "next/server";
import { callPython } from "@/lib/python";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

export async function POST(req: NextRequest) {
  const tempPaths: string[] = [];
  try {
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    const mode = formData.get("mode") as string | null;

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const bytes = await file.arrayBuffer();
      const ext = file.name.split(".").pop() || "bin";
      const safeName = `carpinteria-${Date.now()}-${i}.${ext}`;
      const tempPath = join(tmpdir(), safeName);
      await writeFile(tempPath, Buffer.from(bytes));
      tempPaths.push(tempPath);
    }

    let result;
    if (mode === "pliego") {
      result = await callPython({
        action: "analyze_pliego",
        file_paths: tempPaths,
      });
    } else {
      result = await callPython({
        action: "analyze",
        image_path: tempPaths[0],
      });
    }

    return NextResponse.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    for (const p of tempPaths) {
      await unlink(p).catch(() => {});
    }
  }
}
