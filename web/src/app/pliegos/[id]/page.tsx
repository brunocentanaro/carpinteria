"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ArrowLeft, ArrowUpRight, Download, FileText } from "lucide-react";

import { getSession } from "@/features/chat/api";

export default function PliegoDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const query = useQuery({ queryKey: ["pliego", id], queryFn: () => getSession(id) });

  if (query.isLoading) return <main className="p-8 text-sm text-muted-foreground">Cargando cotización…</main>;
  if (query.isError || !query.data) return <main className="p-8"><div className="flex gap-2 text-sm text-destructive"><AlertCircle className="h-5 w-5" />{query.error?.message || "No se encontró el pliego"}</div></main>;

  const session = query.data;
  const specs = session.general_specs || {};
  return <main className="min-h-screen bg-muted/25">
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
      <Link href="/pliegos" className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Volver a Pliegos</Link>

      <header className="rounded-xl border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase text-primary">{session.source_type === "compras_estatales" ? `Compra estatal · ARCE #${session.external_id}` : "Pliego propio"}</div>
            <h1 className="mt-1 text-2xl font-semibold">{session.title}</h1>
            {session.source_organization && <p className="mt-1 text-sm text-muted-foreground">{session.source_organization}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/sessions/${encodeURIComponent(id)}/export/excel`} className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium"><Download className="h-4 w-4" />Excel</a>
            <a href={`/api/sessions/${encodeURIComponent(id)}/export/docx`} className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium"><Download className="h-4 w-4" />Word</a>
            {session.source_url && <a href={session.source_url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium">Llamado oficial <ArrowUpRight className="h-4 w-4" /></a>}
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Datum label="Total cotizado" value={session.total ? money(session.total) : "Pendiente de completar"} />
        <Datum label="Entrega" value={specs.delivery_days ? `${specs.delivery_days} días` : "A confirmar"} />
        <Datum label="Lugar" value={specs.delivery_location || "A confirmar"} />
        <Datum label="Pago" value={specs.payment_terms || "A confirmar"} />
      </section>

      {session.processing_error && <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><AlertCircle className="h-5 w-5" />{session.processing_error}</div>}

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b bg-muted/30 px-5 py-3"><h2 className="font-semibold">Artículos cotizados</h2></div>
        {session.items.length === 0 && session.moldura_quotes.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No se detectaron artículos cotizables automáticamente.</div>}
        <div className="divide-y">{session.items.map((item) => <article key={item.code} className="grid gap-3 p-5 md:grid-cols-[1fr_auto]">
          <div><div className="flex items-center gap-2"><span className="rounded bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">{item.code}</span><h3 className="font-semibold">{item.name || item.description}</h3></div><p className="mt-2 text-sm text-muted-foreground">Cantidad: {item.quantity} · Material: {item.material || "a confirmar"} · Espesor: {item.thickness_mm || "—"} mm</p>{item.notes && <p className="mt-2 text-sm text-amber-700">{item.notes}</p>}</div>
          <div className="text-right"><div className="text-xs text-muted-foreground">Subtotal</div><div className="font-semibold">{item.last_quote?.total_with_hardware ? money(item.last_quote.total_with_hardware) : item.last_quote?.total ? money(item.last_quote.total) : "Pendiente"}</div></div>
        </article>)}</div>
      </section>
    </div>
  </main>;
}

function money(value: number) {
  return `$${value.toLocaleString("es-UY", { maximumFractionDigits: 0 })}`;
}

function Datum({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-card p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><FileText className="h-4 w-4" />{label}</div><div className="mt-2 font-semibold">{value}</div></div>;
}
