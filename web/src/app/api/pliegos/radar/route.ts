import { NextRequest, NextResponse } from "next/server";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { AUTH_COOKIE, readSessionToken } from "@/lib/auth";
import { getCallAttachments, getPublicCalls } from "@/lib/compras-estatales";
import { callPython } from "@/lib/python";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const auth = readSessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (!auth) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const requestedIds = new Set<string>(Array.isArray(body?.ids) ? body.ids.map(String) : []);
  const calls = (await getPublicCalls()).filter((call) => requestedIds.size === 0 || requestedIds.has(call.id));
  const root = join(tmpdir(), `radar-pliegos-${Date.now()}`);
  await mkdir(root, { recursive: true });
  const results: Record<string, unknown>[] = [];
  try {
    for (const call of calls) {
      try {
        const attachments = await getCallAttachments(call);
        if (!attachments.length) {
          results.push({ id: call.id, status: "without_files", title: call.title });
          continue;
        }
        const paths: string[] = [];
        for (let index = 0; index < attachments.length; index++) {
          const url = attachments[index];
          const response = await fetch(url, { headers: { "User-Agent": "Carpinteria-Juan-Pirone/1.0 (+consulta-publica)" }, cache: "no-store" });
          if (!response.ok) throw new Error(`No se pudo descargar ${url}: ${response.status}`);
          const filename = decodeURIComponent(new URL(url).pathname.split("/").pop() || `adjunto-${index}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = join(root, `${call.id}-${index}-${filename}`);
          await writeFile(path, Buffer.from(await response.arrayBuffer()));
          paths.push(path);
        }
        const result = await callPython({
          action: "radar_pliego_ingest", file_paths: paths,
          user_id: auth.user, brand_id: "casa", area: auth.area,
          source: { type: "compras_estatales", external_id: call.id, title: `${call.title} - ${call.organization}`, url: call.href, organization: call.organization, category: call.category, deadline: call.deadline, published: call.published, files: attachments },
        });
        results.push({ id: call.id, title: call.title, status: result.error ? "failed" : result.skipped ? "existing" : "complete", ...result });
      } catch (error) {
        results.push({ id: call.id, title: call.title, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
    return NextResponse.json({ results, processedAt: new Date().toISOString() });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
