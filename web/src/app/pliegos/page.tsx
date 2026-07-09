"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowUpRight, CheckCircle2, Clock3, FileText, RefreshCw, UploadCloud } from "lucide-react";
import { createSession, listSessions, uploadPliego } from "@/features/chat/api";
import { useBrandEnvironment } from "@/components/BrandEnvironmentProvider";

export default function PliegosPage() {
  const { brandId } = useBrandEnvironment();
  const queryClient = useQueryClient();
  const autoSyncStarted = useRef(false);
  const [dragging, setDragging] = useState(false);
  const sessions = useQuery({ queryKey: ["pliegos", brandId], queryFn: () => listSessions(brandId) });
  const sync = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/pliegos/radar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron procesar los llamados");
      return data;
    },
    onSuccess: () => {
      window.localStorage.setItem("radar-pliegos-last-sync", String(Date.now()));
      queryClient.invalidateQueries({ queryKey: ["pliegos"] });
    },
  });
  const manualUpload = useMutation({
    mutationFn: async (files: File[]) => {
      const title = files[0]?.name.replace(/\.[^.]+$/, "") || "Pliego propio";
      const session = await createSession({ title, brandId, sourceType: "manual_pliego" });
      await uploadPliego({ sessionId: session.id, files, surface: "pliegos" });
      return session.id;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pliegos"] }),
  });
  useEffect(() => {
    if (brandId !== "casa" || autoSyncStarted.current) return;
    autoSyncStarted.current = true;
    const lastSync = Number(window.localStorage.getItem("radar-pliegos-last-sync") || 0);
    if (Date.now() - lastSync < 30 * 60 * 1000) return;
    sync.mutate();
  }, [brandId, sync]);
  const rows = (sessions.data || []).filter((session) => ["compras_estatales", "manual_pliego"].includes(session.source_type));

  function acceptFiles(files: File[]) {
    const supported = files.filter((file) => /\.(pdf|xlsx?|csv|txt)$/i.test(file.name));
    if (supported.length) manualUpload.mutate(supported);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFiles(Array.from(event.target.files || []));
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFiles(Array.from(event.dataTransfer.files));
  }

  return <main className="min-h-screen bg-muted/25">
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between">
        <div><div className="text-xs font-semibold uppercase text-primary">Centro de cotizaciones</div><h1 className="mt-1 text-2xl font-semibold">Pliegos a cotizar</h1><p className="mt-1 text-sm text-muted-foreground">Cotizaciones del radar estatal y pliegos propios, separados del chat.</p></div>
        <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />{sync.isPending ? "Procesando llamados..." : "Actualizar desde ARCE"}</button>
      </header>

      {sync.isError && <div className="mt-4 flex gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="h-5 w-5" />{sync.error.message}</div>}
      {sync.isSuccess && <div className="mt-4 flex gap-2 border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-5 w-5" />Radar actualizado. Los llamados nuevos quedaron procesados y los existentes no se duplicaron.</div>}

      <section className="mt-6 rounded-xl border bg-card p-5">
        <div className="mb-4"><h2 className="font-semibold">Agregar un pliego propio</h2><p className="text-sm text-muted-foreground">Para pedidos privados, invitaciones o documentos que no provienen de Compras Estatales.</p></div>
        <label
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"}`}
        >
          <UploadCloud className="mb-2 h-7 w-7 text-primary" />
          <span className="text-sm font-medium">{manualUpload.isPending ? "Procesando el pliego…" : "Soltá los archivos acá o elegilos desde tu equipo"}</span>
          <span className="mt-1 text-xs text-muted-foreground">PDF, Excel, CSV o TXT</span>
          <input type="file" multiple accept=".pdf,.xls,.xlsx,.csv,.txt" disabled={manualUpload.isPending} onChange={handleFileChange} className="sr-only" />
        </label>
        {manualUpload.isError && <div className="mt-3 flex gap-2 text-sm text-destructive"><AlertCircle className="h-5 w-5" />{manualUpload.error.message}</div>}
        {manualUpload.isSuccess && <div className="mt-3 flex gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-5 w-5" />Pliego procesado y agregado a la lista.</div>}
      </section>

      <div className="mt-6 overflow-hidden border bg-card">
        <div className="grid grid-cols-[1fr_auto] border-b bg-muted/30 px-4 py-3 text-xs font-semibold uppercase text-muted-foreground"><span>Llamado y resumen</span><span>Estado</span></div>
        {sessions.isLoading && <div className="p-10 text-center text-sm text-muted-foreground">Cargando pliegos...</div>}
        {!sessions.isLoading && rows.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">Todavía no hay pliegos. Actualizá desde ARCE o cargá uno propio arriba.</div>}
        <div className="divide-y">{rows.map((row) => {
          const specs = row.general_specs;
          const ready = row.processing_status === "complete";
          return <article key={row.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_15rem]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs"><span className="bg-primary/10 px-2 py-1 font-semibold text-primary">{row.source_type === "manual_pliego" ? "Pliego propio" : row.source_category || "Carpintería"}</span>{row.source_type === "compras_estatales" && <><span className="flex items-center gap-1 font-medium text-amber-700"><Clock3 className="h-3.5 w-3.5" />Cierra {row.source_deadline || "a confirmar"}</span><span className="text-muted-foreground">ARCE #{row.external_id}</span></>}</div>
              <h2 className="mt-2 text-lg font-semibold">{row.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{row.source_organization}</p>
              <div className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <Datum label="Artículos cotizables" value={String(row.item_count)} />
                <Datum label="Cotización" value={row.total ? `$${row.total.toLocaleString("es-UY")}` : "Pendiente de completar"} />
                <Datum label="Entrega" value={specs.delivery_days ? `${specs.delivery_days} días` : "A confirmar"} />
                <Datum label="Lugar" value={specs.delivery_location || "A confirmar"} />
                <Datum label="Pago" value={specs.payment_terms || "A confirmar"} />
                <Datum label="Mantenimiento de oferta" value={specs.offer_maintenance_days ? `${specs.offer_maintenance_days} días` : "A confirmar"} />
              </div>
              {row.processing_error && <p className="mt-3 text-sm text-destructive">{row.processing_error}</p>}
            </div>
            <div className="flex flex-col justify-between gap-3 border-t pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <div className="flex items-center gap-2 text-sm font-medium">{ready ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : row.processing_status === "failed" ? <AlertCircle className="h-5 w-5 text-destructive" /> : <Clock3 className="h-5 w-5 text-amber-600" />}{ready ? "Procesado" : row.processing_status === "failed" ? "Requiere revisión" : "Pendiente"}</div>
              <div className="grid gap-2"><Link href={`/pliegos/${encodeURIComponent(row.id)}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"><FileText className="h-4 w-4" />Ver cotización</Link>{row.source_url && <a href={row.source_url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted">Ver llamado <ArrowUpRight className="h-4 w-4" /></a>}</div>
            </div>
          </article>;
        })}</div>
      </div>
    </div>
  </main>;
}

function Datum({ label, value }: { label: string; value: string }) {
  return <div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-0.5 font-medium">{value}</div></div>;
}
